import {
	RiArrowDownSLine,
	RiCheckLine,
	RiCollapseVerticalLine,
	RiGitRepositoryLine,
} from "@remixicon/react";
import type { GitRepoInfo } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	isChatWorkspace,
	selectActiveFilePath,
	selectDiffScope,
	selectFilesTreeView,
	selectWorkspaceById,
	useAppStore,
} from "../store";
import { ChangesPanel } from "./ChangesPanel";
import {
	buildChangeMarks,
	buildChangesTree,
	type ChangeMarks,
	changesForRepo,
	changeTreeFolderPaths,
} from "./changesModel";
import { FileTree } from "./FileTree";
import { HeaderIconButton } from "./HeaderIconButton";
import { RememberedScrollArea } from "./RememberedScrollArea";
import { useGitStatus } from "./useGitStatus";

export function FilesPanel({ workspaceId }: { workspaceId: string }) {
	const t = useT();
	const chat = useAppStore((s) => {
		const workspace = selectWorkspaceById(s, workspaceId);
		return workspace !== null && isChatWorkspace(workspace);
	});
	const mode = useAppStore((s) => (chat ? "all" : s.filesMode));
	const setMode = useAppStore((s) => s.setFilesMode);
	const setFilesRepo = useAppStore((s) => s.setFilesRepo);
	const setDiffScope = useAppStore((s) => s.setDiffScope);
	const changesView = useAppStore((s) => s.changesView);
	const { status, error, reload } = useGitStatus(chat ? null : workspaceId);
	const selectedRepo = useAppStore((s) => selectFilesTreeView(s, workspaceId).repo ?? "");
	const visibleChanges = useMemo(
		() => changesForRepo(status?.changes ?? [], selectedRepo),
		[status, selectedRepo],
	);
	const marks = useMemo(() => buildChangeMarks(visibleChanges), [visibleChanges]);
	const count = visibleChanges.length;
	const repos = status?.repos ?? [];
	const visibleStatus = status ? { ...status, changes: visibleChanges } : status;
	useEffect(() => {
		const scope = selectDiffScope(useAppStore.getState(), workspaceId);
		if (selectedRepo) {
			if (scope.kind !== "branch" || scope.repo !== selectedRepo) {
				setDiffScope(workspaceId, { kind: "branch", repo: selectedRepo });
			}
		} else if (scope.kind === "branch" && scope.repo) {
			setDiffScope(workspaceId, { kind: "branch" });
		}
	}, [selectedRepo, workspaceId, setDiffScope]);
	const canCollapse = mode === "all" || (changesView === "tree" && count > 0);
	const collapseAll = () => {
		const store = useAppStore.getState();
		if (mode === "all") store.collapseAllFiles(workspaceId);
		else if (status) {
			store.setChangedTreeCollapsed(
				workspaceId,
				changeTreeFolderPaths(buildChangesTree(visibleChanges)),
				true,
			);
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="files-mode-toggle"
				role="toolbar"
				aria-label={t("panels.files.toolbar")}
				className="flex h-panel-header-row shrink-0 items-center gap-4 overflow-clip border-border-default border-b px-12"
			>
				<ToggleSegment
					testid="files-mode-all"
					label={t("panels.files.all")}
					active={mode === "all"}
					onClick={() => setMode("all")}
				/>
				{chat ? null : (
					<ToggleSegment
						testid="files-mode-changed"
						label={
							count > 0 ? t("panels.files.changedCount", { count }) : t("panels.files.changed")
						}
						active={mode === "changed"}
						onClick={() => setMode("changed")}
					/>
				)}
				<div className="ml-auto flex min-w-0 shrink-0 items-center gap-4">
					{repos.length > 0 || selectedRepo ? (
						<RepoPicker
							repos={repos}
							selected={selectedRepo}
							onSelect={(repo) => {
								setFilesRepo(workspaceId, repo);
								setDiffScope(workspaceId, repo ? { kind: "branch", repo } : { kind: "branch" });
							}}
						/>
					) : null}
					{canCollapse ? (
						<HeaderIconButton
							testid="files-collapse-all"
							label={t("panels.files.collapseAll")}
							onClick={collapseAll}
							icon={RiCollapseVerticalLine}
						/>
					) : null}
				</div>
			</div>
			{mode === "all" ? (
				<AllFiles workspaceId={workspaceId} marks={marks} />
			) : (
				<div className="min-h-0 flex-1">
					<ChangesPanel
						workspaceId={workspaceId}
						repo={selectedRepo}
						status={visibleStatus}
						error={error}
						reload={reload}
					/>
				</div>
			)}
		</div>
	);
}

function RepoPicker({
	repos,
	selected,
	onSelect,
}: {
	repos: readonly GitRepoInfo[];
	selected: string;
	onSelect: (repo: string) => void;
}) {
	const t = useT();
	const options = repos.some((repo) => repo.path === selected)
		? repos
		: selected
			? [{ path: selected }, ...repos]
			: repos;
	const label = selected || t("panels.files.workspaceRoot");
	const choose = (repo: string) => onSelect(repo);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				data-testid="files-repo-trigger"
				aria-label={t("panels.files.repoLabel", { repo: label })}
				className="flex h-20 max-w-[180px] min-w-0 items-center gap-4 rounded-sm px-4 text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
			>
				<RiGitRepositoryLine aria-hidden="true" className="size-12 shrink-0" />
				<span className="truncate tr-text-metadata">{label}</span>
				<RiArrowDownSLine aria-hidden="true" className="size-12 shrink-0" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" data-testid="files-repo-menu">
				<DropdownMenuLabel>{t("panels.files.repoMenu")}</DropdownMenuLabel>
				<DropdownMenuItem
					data-testid="files-repo-option"
					data-path=""
					data-active={selected === "" || undefined}
					onSelect={() => choose("")}
				>
					<span className="flex w-14 shrink-0 justify-center">
						{selected === "" ? <RiCheckLine className="text-primary" /> : null}
					</span>
					<span className="truncate">{t("panels.files.workspaceRoot")}</span>
				</DropdownMenuItem>
				{options.map((repo) => (
					<DropdownMenuItem
						key={repo.path}
						data-testid="files-repo-option"
						data-path={repo.path}
						data-active={selected === repo.path || undefined}
						onSelect={() => choose(repo.path)}
					>
						<span className="flex w-14 shrink-0 justify-center">
							{selected === repo.path ? <RiCheckLine className="text-primary" /> : null}
						</span>
						<span className="truncate">{repo.path}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function AllFiles({ workspaceId, marks }: { workspaceId: string; marks: ChangeMarks }) {
	const activePath = useAppStore((s) => selectActiveFilePath(s, workspaceId));
	const repo = useAppStore((s) => selectFilesTreeView(s, workspaceId).repo ?? "");
	const [revealOnMount] = useState(
		() =>
			activePath !== null &&
			activePath !== selectFilesTreeView(useAppStore.getState(), workspaceId).seenActivePath,
	);
	const [revealTarget, setRevealTarget] = useState<string | null>(null);
	const previousActive = useRef<string | null | undefined>(revealOnMount ? undefined : activePath);

	useEffect(() => {
		const before = previousActive.current;
		previousActive.current = activePath;
		if (activePath === null || activePath === before) return;
		useAppStore.getState().revealInFiles(workspaceId, activePath);
		setRevealTarget(activePath);
	}, [activePath, workspaceId]);

	return (
		<RememberedScrollArea
			workspaceId={workspaceId}
			view="all"
			scope={repo}
			restore={!revealOnMount}
			className="min-h-0 flex-1"
			viewportClassName="p-panel-inset"
		>
			<FileTree
				workspaceId={workspaceId}
				marks={marks}
				activePath={activePath}
				revealTarget={revealTarget}
				onRevealed={() => setRevealTarget(null)}
			/>
		</RememberedScrollArea>
	);
}
