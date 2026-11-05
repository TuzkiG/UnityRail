import type { GitStatus } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	type CenterNavigationStamp,
	type ChangesTab,
	type EditorTab,
	isCenterNavigationCurrent,
	isFileComparison,
	matchesWorktreePath,
	selectActiveEditorTab,
	selectDiffBaseRef,
	selectDiffScope,
	selectFilesTreeView,
	selectWorkspaceById,
	selectWorkspaceNavTick,
	type TabIntent,
	toast,
	useAppStore,
} from "../store";
import { errorText, getTransport } from "../transport";
import { BranchPicker } from "./BranchPicker";
import { useBranchList } from "./branches";
import { ChangedFileList } from "./ChangedFileList";
import { ChangesScopeMenu } from "./ChangesScopeMenu";
import { ChangesTree } from "./ChangesTree";
import { changesTabId, scopeKey } from "./changesModel";
import { openChangesTab, openDiffInTab } from "./openTabs";
import { RememberedScrollArea } from "./RememberedScrollArea";

function selectReviewTab(
	state: { tabsByWorkspace: Record<string, EditorTab[]> },
	workspaceId: string,
	id: string,
): ChangesTab | undefined {
	return (state.tabsByWorkspace[workspaceId] ?? []).find(
		(tab): tab is ChangesTab => tab.id === id && tab.kind === "changes",
	);
}

export function ChangesPanel({
	workspaceId,
	repo,
	status,
	error,
	reload,
}: {
	workspaceId: string;
	repo: string;
	status: GitStatus | null;
	error: string | null;
	reload: () => void;
}) {
	const t = useT();
	const changesRequest = useAppStore((s) => s.changesRequest);
	const changesView = useAppStore((s) => s.changesView);
	const setChangesView = useAppStore((s) => s.setChangesView);
	const setDiffScope = useAppStore((s) => s.setDiffScope);
	const scope = useAppStore((s) => selectDiffScope(s, workspaceId));
	const workspace = useAppStore((s) => selectWorkspaceById(s, workspaceId));
	const baseRef = useAppStore((s) => selectDiffBaseRef(s, workspaceId));
	const branchList = useBranchList(workspace?.projectId ?? null, undefined, {
		workspaceId,
		...(repo ? { repo } : {}),
	});
	const repoBaseRef =
		repo && scope.kind === "branch"
			? (scope.baseRef ?? branchList.branches?.upstream ?? branchList.branches?.defaultBranch ?? "")
			: "";
	// The effective scope is what every read uses, so a nested branch scope needs no second persist:
	// the host resolves the sub-repository's own upstream when `baseRef` is absent.
	const effectiveScope =
		repo && scope.kind === "branch"
			? { ...scope, repo, ...(repoBaseRef ? { baseRef: repoBaseRef } : {}) }
			: scope;
	const selectedBaseRef = repo ? (scope.kind === "branch" ? repoBaseRef : "") : baseRef;
	const viewKey = `${scopeKey(effectiveScope)}:${selectedBaseRef}`;
	const [highlight, setHighlight] = useState<{ key: string; path: string } | null>(null);
	const highlighted = highlight?.key === viewKey ? highlight.path : null;
	const setHighlighted = useCallback(
		(path: string | null) => setHighlight(path === null ? null : { key: viewKey, path }),
		[viewKey],
	);
	const activeDiffTab = useAppStore((state) => {
		const tab = selectActiveEditorTab(state, workspaceId);
		return tab?.kind === "diff" && !isFileComparison(tab) ? tab : null;
	});
	const reviewTabId = changesTabId(workspaceId, effectiveScope);
	const reviewActivePath = useAppStore(
		(state) => selectReviewTab(state, workspaceId, reviewTabId)?.activePath,
	);
	const reviewViewed = useAppStore(
		(state) => selectReviewTab(state, workspaceId, reviewTabId)?.viewed,
	);
	const reviewTabActive = useAppStore(
		(state) => state.activeTabByWorkspace[workspaceId] === reviewTabId,
	);
	const viewed = useMemo(() => new Set(reviewViewed ?? []), [reviewViewed]);
	const collapsedList = useAppStore((s) => selectFilesTreeView(s, workspaceId).changedCollapsed);
	const collapsed = useMemo(() => new Set(collapsedList), [collapsedList]);

	const pointAt = async (ref: string) => {
		if (repo) {
			setDiffScope(workspaceId, { kind: "branch", repo, baseRef: ref });
			return;
		}
		try {
			await getTransport().request("workspace.setDiffBase", { id: workspaceId, ref });
		} catch (error) {
			toast.error(t("changes.panel.setBaseFailed", { error: errorText(error) }));
		}
	};

	const openDiff = useCallback(
		(
			path: string,
			intent: TabIntent,
			navigation?: CenterNavigationStamp | null,
			claimPreview = false,
		) => {
			setHighlighted(path);
			if (intent === "keep") {
				void openDiffInTab(workspaceId, effectiveScope, path, intent, navigation, {
					claimPreview,
				});
				return;
			}
			void openChangesTab(workspaceId, effectiveScope, { revealPath: path }, intent, navigation);
		},
		[workspaceId, effectiveScope, setHighlighted],
	);

	useEffect(() => {
		if (changesRequest?.workspaceId !== workspaceId) return;
		if (useAppStore.getState().changesRequest !== changesRequest) return;
		const want = changesRequest.path;
		const currentState = useAppStore.getState();
		const overtaken = changesRequest.navigation
			? !isCenterNavigationCurrent(currentState, workspaceId, changesRequest.navigation)
			: selectWorkspaceNavTick(currentState, workspaceId) !== changesRequest.navTick;
		if (want === null) {
			if (!overtaken) {
				void openChangesTab(workspaceId, effectiveScope, {}, "preview", changesRequest.navigation);
			}
		} else {
			if (!status) return;
			const match = status.changes.find((c) => matchesWorktreePath(want, c.path));
			if (match && !overtaken) openDiff(match.path, "preview", changesRequest.navigation);
			else setHighlighted(match ? match.path : want);
		}
		useAppStore.getState().clearChangesRequest();
	}, [changesRequest, status, workspaceId, openDiff, effectiveScope, setHighlighted]);

	useEffect(() => {
		if (activeDiffTab || reviewTabActive) setHighlighted(null);
	}, [activeDiffTab, reviewTabActive, setHighlighted]);

	const isActive = (path: string) =>
		reviewTabActive && reviewActivePath !== undefined
			? reviewActivePath === path
			: activeDiffTab
				? activeDiffTab.path === path && scopeKey(activeDiffTab.scope) === scopeKey(effectiveScope)
				: highlighted === path;
	const isViewed = (path: string) => viewed.has(path);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="changes-view-toggle"
				role="toolbar"
				aria-label={t("changes.panel.toolbar")}
				className="flex h-panel-header-row shrink-0 items-center gap-4 overflow-x-clip border-border-default border-b px-12"
			>
				<div className="mr-auto flex min-w-0 items-center gap-4">
					<ChangesScopeMenu
						key={`${workspaceId}:${selectedBaseRef}`}
						workspaceId={workspaceId}
						scope={effectiveScope}
						onSelectScope={(next) =>
							setDiffScope(
								workspaceId,
								repo && next.kind === "branch"
									? { ...next, repo, ...(repoBaseRef ? { baseRef: repoBaseRef } : {}) }
									: next,
							)
						}
					/>
					{workspace ? (
						<div className="flex min-w-0 max-w-[200px]">
							<BranchPicker
								branches={branchList.branches}
								failed={branchList.failed}
								selected={selectedBaseRef}
								refreshing={branchList.refreshing}
								label={t("changes.panel.versus")}
								testid="changes-target-picker"
								onSelect={(ref) => void pointAt(ref)}
								onRefresh={branchList.refresh}
							/>
						</div>
					) : null}
				</div>
				<ToggleSegment
					testid="changes-toggle-list"
					label={t("changes.panel.list")}
					active={changesView === "list"}
					onClick={() => setChangesView("list")}
				/>
				<ToggleSegment
					testid="changes-toggle-tree"
					label={t("changes.panel.tree")}
					active={changesView === "tree"}
					onClick={() => setChangesView("tree")}
				/>
			</div>
			{changesView === "tree" || status === null || status.changes.length === 0 ? (
				<RememberedScrollArea
					key={`${changesView}:${viewKey}`}
					workspaceId={workspaceId}
					view={changesView === "tree" ? "changedTree" : "changedList"}
					scope={viewKey}
					className="min-h-0 flex-1"
					viewportClassName="p-panel-inset"
				>
					{status === null && error !== null ? (
						<div data-testid="changes-error" className="flex flex-col items-start gap-4 px-8 py-4">
							<p className="tr-text-metadata text-feedback-error">
								{t("changes.readFailed", { error })}
							</p>
							<Button variant="ghost" size="s" data-testid="changes-retry" onClick={reload}>
								{t("common.retry")}
							</Button>
						</div>
					) : status === null ? (
						<LoadingRegion rows={5} className="px-8 py-4" />
					) : status.changes.length === 0 ? (
						<p data-testid="changes-empty" className="px-8 py-4 tr-text-metadata text-text-muted">
							{t("changes.empty")}
						</p>
					) : (
						<ChangesTree
							changes={status.changes}
							onOpen={(path, intent, claimPreview) =>
								openDiff(path, intent, undefined, claimPreview)
							}
							isActive={isActive}
							isViewed={isViewed}
							isCollapsed={(path) => collapsed.has(path)}
							onSetCollapsed={(path, next) =>
								useAppStore.getState().setChangedTreeCollapsed(workspaceId, [path], next)
							}
						/>
					)}
				</RememberedScrollArea>
			) : (
				<div className="flex min-h-0 flex-1 flex-col p-panel-inset">
					<ChangedFileList
						workspaceId={workspaceId}
						scope={viewKey}
						changes={status.changes}
						isActive={isActive}
						isViewed={isViewed}
						onOpen={(path, intent, claimPreview) => openDiff(path, intent, undefined, claimPreview)}
					/>
				</div>
			)}
		</div>
	);
}
