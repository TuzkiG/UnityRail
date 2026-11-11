import {
	RiCheckLine,
	RiDownloadCloud2Line,
	RiErrorWarningLine,
	RiExternalLinkLine,
	RiFolderOpenLine,
	RiLinkM,
	RiRefreshLine,
} from "@remixicon/react";
import type {
	UnityLinkType,
	UnityProjectConfig,
	UnityProjectModule,
	UnityWorkspaceSnapshot,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { QuietScrollArea } from "../components/QuietScrollArea";
import { useAppStore } from "../store";
import { errorText, getTransport } from "../transport";

const LINK_TYPE_KEYS: Record<UnityLinkType, MessageKey> = {
	junction: "unity.link.junction",
	symlink: "unity.link.symlink",
	submodule: "unity.link.submodule",
	repo: "unity.link.repo",
};

/** The business layer always lands on the same mount, never a parallel `Assets/<worktree>` link. */
const BUSINESS_MOUNT_NAME = "Game";

function LinkBadge({ type }: { type: UnityLinkType }) {
	const t = useT();
	return (
		<span className="shrink-0 rounded-sm border border-border-default px-4 py-2 text-text-subtle tr-text-metadata">
			{t(LINK_TYPE_KEYS[type])}
		</span>
	);
}

interface LinkedMeta {
	sourcePath: string;
	mountPath: string | undefined;
	linkType: UnityLinkType | undefined;
	unlinkPath: string;
}

interface LinkedRow {
	key: string;
	name: string;
	sourcePath: string;
	mountPath: string | undefined;
	linkType: UnityLinkType | undefined;
	/** Path handed to `unity.unlinkModule`: the module source, or the project mount for a bare link. */
	unlinkPath: string;
}

function FolderRow({
	name,
	sourcePath,
	mountPath,
	linkType,
	linked,
	onLink,
	onUnlink,
	busy,
}: {
	name: string;
	sourcePath: string;
	mountPath: string | undefined;
	linkType: UnityLinkType | undefined;
	linked: boolean;
	onLink: () => void;
	onUnlink: () => void;
	busy: boolean;
}) {
	const t = useT();
	return (
		<li className="flex flex-col gap-6 border-b border-border-muted px-8 py-6 last:border-b-0">
			<div className="flex items-start gap-8">
				<RiLinkM
					className={cn("mt-2 size-14 shrink-0", linked ? "text-primary" : "text-text-subtle")}
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<span className="break-all text-text-default tr-text-ui">{name}</span>
					<span className="truncate text-text-subtle tr-code-text" title={sourcePath}>
						{sourcePath}
					</span>
					{mountPath ? (
						<span className="truncate text-text-subtle tr-text-metadata" title={mountPath}>
							{t("unity.project.mountedAt", { path: mountPath })}
						</span>
					) : null}
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-4 pl-24">
				{linkType ? <LinkBadge type={linkType} /> : null}
				<Button
					variant={linked ? "ghost" : "outline"}
					size="s"
					onClick={linked ? onUnlink : onLink}
					disabled={busy}
				>
					{linked ? t("unity.project.unlink") : t("unity.project.link")}
				</Button>
			</div>
		</li>
	);
}

export function UnityProjectPanel({ workspaceId }: { workspaceId: string }) {
	const t = useT();
	const [config, setConfig] = useState<UnityProjectConfig | null>(
		() => useAppStore.getState().unityProjectConfigsByWorkspace[workspaceId] ?? null,
	);
	const [snapshot, setSnapshot] = useState<UnityWorkspaceSnapshot | null>(
		() => useAppStore.getState().unitySnapshotsByWorkspace[workspaceId] ?? null,
	);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [draftLinkTarget, setDraftLinkTarget] = useState("");
	const generation = useRef(0);
	const transport = getTransport();

	const load = useCallback(() => {
		generation.current += 1;
		const token = generation.current;
		return Promise.all([
			transport.request("unity.projectConfig", { workspaceId }),
			transport.request("unity.snapshot", { workspaceId }),
		])
			.then(([nextConfig, nextSnapshot]) => {
				if (generation.current !== token) return;
				setConfig(nextConfig);
				setSnapshot(nextSnapshot);
				setError(null);
				const store = useAppStore.getState();
				store.installUnityProjectConfig(workspaceId, nextConfig);
				store.installUnitySnapshot(workspaceId, nextSnapshot);
			})
			.catch((loadError: unknown) => {
				if (generation.current === token) setError(errorText(loadError));
			});
	}, [transport, workspaceId]);

	useEffect(() => {
		void load();
		return () => {
			generation.current += 1;
		};
	}, [load]);

	useEffect(() => {
		setDraftLinkTarget(config?.linkTarget ?? "");
	}, [config?.linkTarget]);

	const run = useCallback(
		(label: string, action: () => Promise<void>) => {
			setBusy(label);
			setError(null);
			setNotice(null);
			void action()
				.then(load)
				.catch((actionError: unknown) => setError(errorText(actionError)))
				.finally(() => setBusy(null));
		},
		[load],
	);

	const pickFolder = useCallback(
		() =>
			transport
				.request("dialog.selectDirectory", {}, { timeoutMs: 30 * 60_000 })
				.then((picked) => picked.path),
		[transport],
	);

	const save = useCallback(
		(update: {
			projectRoot?: string | null;
			businessPath?: string | null;
			linkTarget?: string | null;
			modules?: UnityProjectModule[];
		}) => transport.request("unity.setProjectConfig", { workspaceId, ...update }),
		[transport, workspaceId],
	);

	const chooseProject = useCallback(
		() =>
			run("project", async () => {
				const picked = await pickFolder();
				if (!picked) return;
				setConfig(await save({ projectRoot: picked }));
				setNotice(t("unity.project.saved"));
			}),
		[run, pickFolder, save, t],
	);

	const chooseBusiness = useCallback(
		() =>
			run("business", async () => {
				const picked = await pickFolder();
				if (!picked) return;
				setConfig(await save({ businessPath: picked }));
				setNotice(t("unity.project.pathSaved"));
			}),
		[run, pickFolder, save, t],
	);

	const chooseLinkTarget = useCallback(
		() =>
			run("link-target", async () => {
				const picked = await pickFolder();
				if (!picked) return;
				setDraftLinkTarget(picked);
				setConfig(await save({ linkTarget: picked }));
				setNotice(t("unity.project.pathSaved"));
			}),
		[run, pickFolder, save, t],
	);

	const linkConfiguredTarget = useCallback(
		() =>
			run("link-target", async () => {
				const target = draftLinkTarget.trim();
				if (!target) {
					setError(t("unity.project.linkTargetMissing"));
					return;
				}
				await save({ linkTarget: target });
				setConfig(
					await transport.request("unity.linkModule", {
						workspaceId,
						name: BUSINESS_MOUNT_NAME,
						path: target,
					}),
				);
				setNotice(t("unity.project.linked"));
			}),
		[run, draftLinkTarget, config, save, transport, workspaceId, t],
	);

	const linkModule = useCallback(
		(name: string, path: string) =>
			run("link", async () => {
				setConfig(await transport.request("unity.linkModule", { workspaceId, name, path }));
				setNotice(t("unity.project.linked"));
			}),
		[run, transport, workspaceId, t],
	);

	const unlinkModule = useCallback(
		(path: string) =>
			run("unlink", async () => {
				setConfig(await transport.request("unity.unlinkModule", { workspaceId, path }));
				setNotice(t("unity.project.unlinked"));
			}),
		[run, transport, workspaceId, t],
	);

	const linkArbitraryFolder = useCallback(
		() =>
			run("link", async () => {
				const picked = await pickFolder();
				if (!picked) return;
				const name = picked.split(/[\\/]/).filter(Boolean).at(-1) ?? picked;
				setConfig(await transport.request("unity.linkModule", { workspaceId, name, path: picked }));
				setNotice(t("unity.project.linked"));
			}),
		[run, pickFolder, transport, workspaceId, t],
	);

	const connect = useCallback(
		() =>
			run("connect", async () => {
				if (!config?.projectRoot) {
					setError(t("unity.project.chooseFirst"));
					return;
				}
				if (!snapshot?.bridgeInstalled) {
					await transport.request("unity.installBridge", { workspaceId });
					setNotice(t("unity.project.bridgeInstalled"));
					return;
				}
				if (!snapshot.bridge) {
					await transport.request("unity.openEditor", { workspaceId });
					setNotice(t("unity.notice.openingUnity"));
					return;
				}
				setNotice(t("unity.project.connected"));
			}),
		[run, config, snapshot, transport, workspaceId, t],
	);

	const linked = config?.modules ?? [];
	const externalLinks = config?.externalLinks ?? [];
	const businessFolders = config?.businessFolders ?? [];
	const projectRoot = config?.projectRoot ?? config?.detectedProjectRoot ?? null;
	const normalizedPath = (path: string) =>
		path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
	const businessLink = externalLinks.find((link) => {
		if (link.type !== "junction" && link.type !== "symlink") return false;
		if (!projectRoot) return true;
		const target = normalizedPath(link.target);
		const root = normalizedPath(projectRoot);
		return target !== root && !target.startsWith(`${root}/`);
	});
	const linkedByPath = new Map<string, LinkedMeta>();
	for (const module of linked) {
		linkedByPath.set(module.path, {
			sourcePath: module.path,
			mountPath: module.mountPath,
			linkType: module.linkType,
			unlinkPath: module.path,
		});
	}
	for (const link of externalLinks) {
		if (link.type !== "junction" && link.type !== "symlink") continue;
		if (linkedByPath.has(link.target)) continue;
		linkedByPath.set(link.target, {
			sourcePath: link.path,
			mountPath: link.path,
			linkType: link.type,
			unlinkPath: link.path,
		});
	}
	const connected = snapshot?.bridge !== null && snapshot?.bridge !== undefined;
	// Directory mounts the project already uses are listed alongside the ones this panel made.
	const linkedRows: LinkedRow[] = linked.map((module) => ({
		key: module.path,
		name: module.name,
		sourcePath: module.path,
		mountPath: module.mountPath,
		linkType: module.linkType,
		unlinkPath: module.path,
	}));
	const mountedPaths = new Set(linkedRows.map((row) => row.mountPath ?? row.sourcePath));
	for (const link of externalLinks) {
		if (link.type !== "junction" && link.type !== "symlink") continue;
		if (mountedPaths.has(link.path)) continue;
		linkedRows.push({
			key: link.path,
			name: link.name,
			sourcePath: link.target,
			mountPath: link.path,
			linkType: link.type,
			unlinkPath: link.path,
		});
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-panel-header-row shrink-0 items-center gap-8 border-b border-border-default px-8">
				<RiLinkM
					className={cn("size-14 shrink-0", connected ? "text-primary" : "text-text-muted")}
				/>
				<span className="truncate text-text-default tr-text-ui">{t("unity.project.title")}</span>
				<IconButton
					className="ml-auto"
					variant="ghost"
					size="s"
					icon={RiRefreshLine}
					label={t("unity.action.refresh")}
					onClick={() => void load()}
				/>
			</div>

			{error ? (
				<div
					role="alert"
					className="flex shrink-0 items-center gap-4 border-b border-feedback-error-muted bg-feedback-error-subtle px-8 py-4 tr-text-metadata text-text-default"
				>
					<RiErrorWarningLine className="size-14 shrink-0 text-feedback-error" />
					<span className="min-w-0 flex-1 break-words">{error}</span>
				</div>
			) : null}
			{notice ? (
				<div className="flex shrink-0 items-center gap-4 border-b border-border-default px-8 py-4 tr-text-metadata text-text-muted">
					<RiCheckLine className="size-14 shrink-0 text-primary" />
					<span>{notice}</span>
				</div>
			) : null}

			<QuietScrollArea className="min-h-0 flex-1" viewportClassName="py-8">
				<section className="flex flex-col gap-6 px-8 pb-8">
					<span className="text-text-muted uppercase tr-text-eyebrow">
						{t("unity.project.pathTitle")}
					</span>
					<p className="break-all text-text-default tr-code-text">
						{projectRoot ?? t("unity.project.noPath")}
					</p>
					<div className="flex flex-wrap items-center gap-4">
						<Button
							variant="outline"
							size="s"
							iconLeft={RiFolderOpenLine}
							onClick={() => void chooseProject()}
							disabled={busy !== null}
						>
							{t("unity.project.choose")}
						</Button>
						<Button
							variant={connected ? "ghost" : "primary"}
							size="s"
							iconLeft={connected ? RiExternalLinkLine : RiDownloadCloud2Line}
							onClick={() => void connect()}
							disabled={busy !== null || !projectRoot}
						>
							{connected ? t("unity.action.openUnityNow") : t("unity.project.connect")}
						</Button>
						{config?.detectedProjectRoot && !config.projectRoot ? (
							<Button
								variant="ghost"
								size="s"
								onClick={() =>
									void run("project", async () => {
										setConfig(await save({ projectRoot: config.detectedProjectRoot }));
									})
								}
								disabled={busy !== null}
							>
								{t("unity.project.useDetected")}
							</Button>
						) : null}
					</div>
					<p className="text-text-subtle tr-text-metadata">
						{connected ? t("unity.project.statusConnected") : t("unity.project.statusDisconnected")}
					</p>
				</section>

				<section className="flex flex-col gap-4 px-8 pb-8">
					<span className="text-text-muted uppercase tr-text-eyebrow">
						{t("unity.project.linkTargetTitle")}
					</span>
					<input
						data-testid="unity-link-target"
						aria-label={t("unity.project.linkTargetTitle")}
						value={draftLinkTarget}
						disabled={busy !== null}
						onChange={(event) => setDraftLinkTarget(event.target.value)}
						placeholder={t("unity.project.linkTargetPlaceholder")}
						spellCheck={false}
						className="h-28 w-full min-w-0 rounded-sm border border-border-default bg-container-workspace-bg px-8 text-text-default placeholder:text-text-subtle tr-code-text outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
					/>
					<div className="flex flex-wrap items-center gap-4">
						<Button
							variant="outline"
							size="s"
							iconLeft={RiFolderOpenLine}
							onClick={() => void chooseLinkTarget()}
							disabled={busy !== null}
						>
							{t("unity.project.linkTargetChoose")}
						</Button>
						<Button
							variant="primary"
							size="s"
							iconLeft={RiLinkM}
							onClick={() => void linkConfiguredTarget()}
							disabled={busy !== null || !draftLinkTarget.trim()}
						>
							{t("unity.project.linkTargetLink")}
						</Button>
						{config?.linkTarget || draftLinkTarget ? (
							<Button
								variant="ghost"
								size="s"
								onClick={() =>
									void run("link-target", async () => {
										setDraftLinkTarget("");
										setConfig(await save({ linkTarget: null }));
									})
								}
								disabled={busy !== null}
							>
								{t("unity.project.clearPath")}
							</Button>
						) : null}
					</div>
					<p className="text-text-subtle tr-text-metadata">{t("unity.project.linkTargetHint")}</p>
				</section>

				<section className="flex flex-col gap-4 px-8 pb-8">
					<span className="text-text-muted uppercase tr-text-eyebrow">
						{t("unity.project.businessTitle")}
					</span>
					<p className="break-all text-text-default tr-code-text">
						{config?.businessPath ?? t("unity.project.noPath")}
					</p>
					{businessLink ? (
						<p className="break-all text-text-subtle tr-text-metadata">
							{t("unity.project.currentLink", {
								name: businessLink.name,
								target: businessLink.target,
							})}
						</p>
					) : null}
					<div className="flex flex-wrap items-center gap-4">
						<Button
							variant="outline"
							size="s"
							iconLeft={RiFolderOpenLine}
							onClick={() => void chooseBusiness()}
							disabled={busy !== null}
						>
							{t("unity.project.choosePath")}
						</Button>
						{config?.businessPath ? (
							<Button
								variant="ghost"
								size="s"
								onClick={() =>
									void run("business", async () => {
										setConfig(await save({ businessPath: null }));
									})
								}
								disabled={busy !== null}
							>
								{t("unity.project.clearPath")}
							</Button>
						) : null}
					</div>
					{businessFolders.length === 0 ? (
						<p className="text-text-subtle tr-text-metadata">{t("unity.project.noFolders")}</p>
					) : (
						<ul className="flex flex-col rounded-sm border border-border-default">
							{businessFolders.map((folder) => {
								const meta = linkedByPath.get(folder.path);
								return (
									<FolderRow
										key={folder.path}
										name={folder.name}
										sourcePath={folder.path}
										mountPath={meta?.mountPath}
										linkType={meta?.linkType}
										linked={meta !== undefined}
										onLink={() => void linkModule(BUSINESS_MOUNT_NAME, folder.path)}
										onUnlink={() => void unlinkModule(meta?.unlinkPath ?? folder.path)}
										busy={busy !== null}
									/>
								);
							})}
						</ul>
					)}
					<p className="text-text-subtle tr-text-metadata">{t("unity.project.folderHint")}</p>
				</section>

				<section className="flex flex-col gap-4 px-8 pb-8">
					<span className="text-text-muted uppercase tr-text-eyebrow">
						{t("unity.project.linkedTitle")}
					</span>
					{linkedRows.length === 0 ? (
						<p className="text-text-subtle tr-text-metadata">{t("unity.project.noneLinked")}</p>
					) : (
						<ul className="flex flex-col rounded-sm border border-border-default">
							{linkedRows.map((row) => (
								<FolderRow
									key={row.key}
									name={row.name}
									sourcePath={row.sourcePath}
									mountPath={row.mountPath}
									linkType={row.linkType}
									linked
									onLink={() => {}}
									onUnlink={() => void unlinkModule(row.unlinkPath)}
									busy={busy !== null}
								/>
							))}
						</ul>
					)}
					<Button
						className="self-start"
						variant="outline"
						size="s"
						iconLeft={RiFolderOpenLine}
						onClick={() => void linkArbitraryFolder()}
						disabled={busy !== null || !config?.projectRoot}
					>
						{t("unity.project.linkFolder")}
					</Button>
				</section>
			</QuietScrollArea>
		</div>
	);
}
