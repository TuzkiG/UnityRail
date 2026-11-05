import {
	RiCameraLine,
	RiCheckboxCircleLine,
	RiDownloadCloud2Line,
	RiErrorWarningLine,
	RiExternalLinkLine,
	RiGamepadLine,
	RiInformationLine,
	RiLoader4Line,
	RiNodeTree,
	RiPauseFill,
	RiPlayFill,
	RiRefreshLine,
	RiStopFill,
} from "@remixicon/react";
import type {
	UnityBridgeStatus,
	UnityCompileStatus,
	UnityConsoleEntry,
	UnityConsolePage,
	UnityDoctorReport,
	UnityGameObjectInspection,
	UnityHierarchyNode,
	UnityHierarchySnapshot,
	UnityLogLevel,
	UnityProjectSummary,
	UnityScreenshotPayload,
	UnityTestRunStatus,
	UnityWorkspaceSnapshot,
	WsMethodName,
	WsParams,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { localeOf, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { QuietScrollArea } from "../components/QuietScrollArea";
import { errorText, getTransport } from "../transport";
import { openFileInTab } from "./openTabs";
import { editorSelectionPath } from "./unitySelection";

type UnityTab = "overview" | "console" | "hierarchy" | "inspector" | "game" | "tests";

const TABS: ReadonlyArray<{ id: UnityTab; label: MessageKey }> = [
	{ id: "overview", label: "unity.tab.overview" },
	{ id: "console", label: "unity.tab.console" },
	{ id: "hierarchy", label: "unity.tab.hierarchy" },
	{ id: "inspector", label: "unity.tab.inspector" },
	{ id: "game", label: "unity.tab.game" },
	{ id: "tests", label: "unity.tab.tests" },
];

type LevelFilter = "all" | "errors" | "warnings";

const LEVEL_FILTERS: ReadonlyArray<{ id: LevelFilter; label: MessageKey }> = [
	{ id: "all", label: "unity.console.filter.all" },
	{ id: "errors", label: "unity.console.filter.errors" },
	{ id: "warnings", label: "unity.console.filter.warnings" },
];

const ERROR_LEVELS: UnityLogLevel[] = ["error", "exception", "assert"];

const LEVEL_KEYS: Record<UnityLogLevel, MessageKey> = {
	error: "unity.console.level.error",
	warning: "unity.console.level.warning",
	log: "unity.console.level.log",
	exception: "unity.console.level.exception",
	assert: "unity.console.level.assert",
};

function hostRequest<M extends WsMethodName>(method: M, params: WsParams<M>) {
	return getTransport().request(method, params);
}

function statusTone(bridge: UnityBridgeStatus | null): string {
	if (!bridge) return "text-text-muted";
	if (bridge.isCompiling) return "text-feedback-warning";
	if (bridge.isPlaying) return "text-feedback-success";
	return "text-primary";
}

function formatTime(t: ReturnType<typeof useT>, iso: string): string {
	try {
		return new Intl.DateTimeFormat(localeOf(t), {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		}).format(new Date(iso));
	} catch {
		return iso;
	}
}

function CountRow({ label, value }: { label: string; value: number }) {
	return (
		<div className="flex items-center justify-between gap-8 border-b border-border-muted py-4 last:border-b-0">
			<span className="text-text-muted tr-text-metadata">{label}</span>
			<span className="text-text-default tr-text-metadata">{value}</span>
		</div>
	);
}

function SectionHeader({ children }: { children: ReactNode }) {
	return <h3 className="text-text-muted uppercase tr-text-eyebrow">{children}</h3>;
}

function CompileSummary({ compile }: { compile: UnityCompileStatus | null }) {
	const t = useT();
	if (!compile) {
		return <p className="text-text-subtle tr-text-metadata">{t("unity.compile.state.idle")}</p>;
	}
	const errors = compile.diagnostics.filter((entry) => entry.severity === "error").length;
	const warnings = compile.diagnostics.length - errors;
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-8">
				<span
					className={cn(
						"tr-text-metadata",
						compile.state === "failed"
							? "text-feedback-error"
							: compile.state === "compiling"
								? "text-feedback-warning"
								: "text-feedback-success",
					)}
				>
					{compile.state === "failed"
						? t("unity.compile.state.failed")
						: compile.state === "compiling"
							? t("unity.compile.state.compiling")
							: t("unity.compile.state.succeeded")}
				</span>
				{compile.durationMs !== undefined ? (
					<span className="text-text-subtle tr-text-metadata">
						{t("unity.units.ms", { value: compile.durationMs })}
					</span>
				) : null}
				<span className="text-text-subtle tr-text-metadata">
					{t("unity.tool.compile.summary", { errors, warnings })}
				</span>
			</div>
		</div>
	);
}

function ConsoleRow({ entry, t }: { entry: UnityConsoleEntry; t: ReturnType<typeof useT> }) {
	const tone =
		entry.level === "error" || entry.level === "exception" || entry.level === "assert"
			? "text-feedback-error"
			: entry.level === "warning"
				? "text-feedback-warning"
				: "text-text-muted";
	return (
		<div className="flex flex-col gap-2 border-b border-border-muted py-4 last:border-b-0">
			<div className="flex items-center gap-8">
				<span className={cn("uppercase tr-text-metadata", tone)}>{t(LEVEL_KEYS[entry.level])}</span>
				<span className="text-text-subtle tr-text-metadata">{formatTime(t, entry.time)}</span>
				<span className="ml-auto text-text-subtle tr-text-metadata">#{entry.seq}</span>
			</div>
			<p className="whitespace-pre-wrap break-words text-text-default tr-code-text">
				{entry.message}
			</p>
			{(entry.level === "error" || entry.level === "exception") && entry.stackTrace ? (
				<pre className="overflow-auto whitespace-pre-wrap break-words text-text-subtle tr-code-text">
					{entry.stackTrace}
				</pre>
			) : null}
		</div>
	);
}

function HierarchyRows({
	nodes,
	selectedPath,
	onSelect,
}: {
	nodes: readonly UnityHierarchyNode[];
	selectedPath: string | null;
	onSelect: (node: UnityHierarchyNode) => void;
}) {
	return (
		<ul className="flex flex-col">
			{nodes.map((node) => (
				<li key={`${node.instanceId}:${node.path}`}>
					<button
						type="button"
						onClick={() => onSelect(node)}
						data-selected={node.path === selectedPath}
						className={cn(
							"flex w-full items-center gap-4 rounded-sm px-8 py-2 text-left tr-text-ui",
							"hover:bg-control-bg-hovered data-[selected=true]:bg-control-bg-selected",
							node.activeInHierarchy ? "text-text-default" : "text-text-disabled",
						)}
					>
						<span className="min-w-0 flex-1 truncate">{node.name}</span>
						{node.components.length > 0 ? (
							<span className="shrink-0 text-text-subtle tr-text-metadata">
								{node.components.map((component) => component.type).join(", ")}
							</span>
						) : null}
					</button>
					{node.children.length > 0 ? (
						<div className="ml-12 border-l border-border-muted pl-4">
							<HierarchyRows
								nodes={node.children}
								selectedPath={selectedPath}
								onSelect={onSelect}
							/>
						</div>
					) : null}
				</li>
			))}
		</ul>
	);
}

function ProjectOverview({
	project,
	bridge,
	bridgeError,
	bridgeInstalled,
	bridgePackageStale,
	doctor,
	onDiagnose,
	onOpenEditor,
	onInstallBridge,
	onCompile,
	onOpenFile,
	busy,
}: {
	project: UnityProjectSummary;
	bridge: UnityBridgeStatus | null;
	bridgeError: { code: string; message: string } | null;
	bridgeInstalled: boolean;
	bridgePackageStale: boolean;
	doctor: UnityDoctorReport | null;
	onDiagnose: () => void;
	onOpenEditor: () => void;
	onInstallBridge: () => void;
	onCompile: () => void;
	onOpenFile: (path: string) => void;
	busy: string | null;
}) {
	const t = useT();
	const packages = project.packages.filter((pkg) => !pkg.builtin);
	return (
		<QuietScrollArea className="h-full" viewportClassName="px-8 py-8">
			<div className="flex flex-col gap-16">
				<section className="flex flex-col gap-6">
					<div className="flex flex-wrap items-center gap-8">
						<span className="text-text-default tr-text-ui">
							{project.productName ?? project.root.split(/[\\/]/).at(-1)}
						</span>
						<span className="rounded-sm border border-border-default px-4 py-2 text-text-muted tr-text-metadata">
							{t("unity.overview.version", { version: project.editorVersion })}
						</span>
					</div>
					<p className="break-all text-text-subtle tr-code-text">{project.root}</p>
					<div className="flex flex-wrap gap-8">
						<Button
							variant="outline"
							size="s"
							onClick={onCompile}
							disabled={busy !== null || !bridge}
						>
							{t("unity.action.compile")}
						</Button>
						<Button variant="outline" size="s" onClick={onDiagnose} disabled={busy !== null}>
							{t("unity.action.diagnose")}
						</Button>
						<Button
							variant="outline"
							size="s"
							iconLeft={RiExternalLinkLine}
							onClick={onOpenEditor}
							disabled={busy !== null}
						>
							{t("unity.action.openEditor")}
						</Button>
						{project.scenes[0] ? (
							<Button
								variant="outline"
								size="s"
								iconLeft={RiPlayFill}
								onClick={() => onOpenFile(project.scenes[0]?.path ?? "")}
								disabled={busy !== null}
							>
								{t("unity.action.openScene")}
							</Button>
						) : null}
					</div>
				</section>

				<section className="grid grid-cols-2 gap-x-16">
					<div className="flex flex-col">
						<CountRow label={t("unity.overview.assets")} value={project.counts.assets} />
						<CountRow label={t("unity.overview.scripts")} value={project.counts.scripts} />
						<CountRow label={t("unity.overview.scenes")} value={project.counts.scenes} />
						<CountRow label={t("unity.overview.prefabs")} value={project.counts.prefabs} />
					</div>
					<div className="flex flex-col">
						<div className="border-b border-border-muted py-4">
							<div className="flex items-center gap-4 text-text-muted tr-text-metadata">
								<RiGamepadLine className="size-14" />
								{bridge
									? t("unity.overview.bridgeRunning", { port: bridge.port })
									: t("unity.overview.bridgeMissing")}
							</div>
						</div>
						<div className="flex flex-col border-b border-border-muted py-4">
							<span className="text-text-muted tr-text-metadata">
								{t("unity.overview.lastCompile")}
							</span>
							<CompileSummary compile={bridge?.lastCompile ?? null} />
						</div>
						{bridge?.selection.length ? (
							<div className="py-4">
								<span className="text-text-muted tr-text-metadata">
									{t("unity.status.selection")}
								</span>
								<p className="text-text-default tr-text-metadata">
									{bridge.selection.map((entry) => entry.name).join(", ")}
								</p>
							</div>
						) : null}
					</div>
				</section>

				{bridgeError ? (
					<section className="rounded-sm border border-feedback-warning-muted bg-feedback-warning-subtle px-8 py-6">
						<div className="flex items-center gap-4 text-feedback-warning tr-text-metadata">
							<RiErrorWarningLine className="size-14" />
							<span>{t("unity.overview.bridgeError")}</span>
						</div>
						<p className="mt-4 text-text-default tr-text-metadata">{bridgeError.message}</p>
						<div className="mt-8 flex flex-wrap items-center gap-8">
							{bridgeInstalled && bridgePackageStale ? (
								<Button
									variant="primary"
									size="s"
									iconLeft={RiDownloadCloud2Line}
									onClick={onInstallBridge}
									disabled={busy !== null}
								>
									{t("unity.action.updateBridge")}
								</Button>
							) : bridgeInstalled ? (
								<Button
									variant="primary"
									size="s"
									iconLeft={RiExternalLinkLine}
									onClick={onOpenEditor}
									disabled={busy !== null}
								>
									{t("unity.action.openUnityNow")}
								</Button>
							) : (
								<Button
									variant="primary"
									size="s"
									iconLeft={RiDownloadCloud2Line}
									onClick={onInstallBridge}
									disabled={busy !== null}
								>
									{t("unity.action.installBridge")}
								</Button>
							)}
						</div>
						{!bridgeInstalled ? (
							<p className="mt-4 text-text-subtle tr-text-metadata">
								{t("unity.overview.bridgeMissingHint")}
							</p>
						) : bridgePackageStale ? (
							<p className="mt-4 text-text-subtle tr-text-metadata">
								{t("unity.overview.bridgeStaleHint")}
							</p>
						) : null}
					</section>
				) : null}

				{doctor ? (
					<section className="flex flex-col gap-6">
						<SectionHeader>{t("unity.overview.findings")}</SectionHeader>
						{doctor.findings.length === 0 ? (
							<p className="text-feedback-success tr-text-metadata">
								{t("unity.overview.noFindings")}
							</p>
						) : (
							<ul className="flex flex-col gap-4">
								{doctor.findings.map((finding) => (
									<li
										key={`${finding.code}:${finding.message}`}
										className="flex items-start gap-4 border-b border-border-muted py-4 last:border-b-0"
									>
										{finding.severity === "error" ? (
											<RiErrorWarningLine className="mt-2 size-14 shrink-0 text-feedback-error" />
										) : finding.severity === "warning" ? (
											<RiErrorWarningLine className="mt-2 size-14 shrink-0 text-feedback-warning" />
										) : (
											<RiInformationLine className="mt-2 size-14 shrink-0 text-feedback-info" />
										)}
										<div className="flex min-w-0 flex-col gap-2">
											<span className="text-text-subtle tr-text-metadata">{finding.code}</span>
											<span className="text-text-default tr-text-metadata">{finding.message}</span>
										</div>
									</li>
								))}
							</ul>
						)}
					</section>
				) : null}

				{project.warnings.length > 0 ? (
					<section className="flex flex-col gap-4">
						<SectionHeader>{t("unity.overview.warnings")}</SectionHeader>
						{project.warnings.map((warning) => (
							<p key={warning} className="text-feedback-warning tr-text-metadata">
								{warning}
							</p>
						))}
					</section>
				) : null}

				<section className="flex flex-col gap-4">
					<SectionHeader>
						{t("unity.overview.packages")} ·{" "}
						{t("unity.project.packageCount", { count: packages.length })}
					</SectionHeader>
					<ul className="grid grid-cols-1 gap-2">
						{packages.slice(0, 30).map((pkg) => (
							<li
								key={pkg.name}
								className="flex items-center justify-between gap-8 tr-text-metadata"
							>
								<span className="min-w-0 truncate text-text-default">{pkg.name}</span>
								<span className="shrink-0 text-text-subtle">{pkg.version}</span>
							</li>
						))}
					</ul>
				</section>

				<section className="flex flex-col gap-4">
					<SectionHeader>
						{t("unity.overview.assemblies")} ·{" "}
						{t("unity.project.assemblyCount", { count: project.assemblies.length })}
					</SectionHeader>
					<ul className="flex flex-col gap-4">
						{project.assemblies.map((assembly) => (
							<li
								key={assembly.name}
								className="flex flex-col gap-2 border-b border-border-muted py-4 last:border-b-0"
							>
								<div className="flex flex-wrap items-center gap-4">
									<span className="text-text-default tr-text-metadata">{assembly.name}</span>
									{assembly.editorOnly ? (
										<span className="rounded-sm border border-border-default px-4 py-2 text-text-subtle tr-text-metadata">
											{t("unity.assembly.editor")}
										</span>
									) : null}
								</div>
								<button
									type="button"
									onClick={() => onOpenFile(assembly.path)}
									className="truncate text-left text-primary tr-code-text hover:underline"
									title={assembly.path}
								>
									{assembly.path}
								</button>
								{assembly.missingReferences.length > 0 ? (
									<span className="text-feedback-error tr-text-metadata">
										{assembly.missingReferences.join(", ")}
									</span>
								) : null}
							</li>
						))}
					</ul>
				</section>

				<section className="flex flex-col gap-4">
					<SectionHeader>{t("unity.overview.scenes")}</SectionHeader>
					<ul className="flex flex-col gap-2">
						{project.scenes.slice(0, 40).map((scene) => (
							<li key={scene.path}>
								<button
									type="button"
									onClick={() => onOpenFile(scene.path)}
									className="flex w-full items-center gap-4 rounded-sm px-2 py-2 text-left hover:bg-control-bg-hovered"
								>
									<RiNodeTree className="size-14 shrink-0 text-text-subtle" />
									<span className="min-w-0 flex-1 truncate text-text-default tr-text-metadata">
										{scene.name}
									</span>
									<span className="truncate text-text-subtle tr-code-text">{scene.path}</span>
								</button>
							</li>
						))}
					</ul>
				</section>
			</div>
		</QuietScrollArea>
	);
}

export function UnityPanel({ workspaceId }: { workspaceId: string }) {
	const t = useT();
	const [snapshot, setSnapshot] = useState<UnityWorkspaceSnapshot | null>(null);
	const [loading, setLoading] = useState(true);
	const [snapshotError, setSnapshotError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [tab, setTab] = useState<UnityTab>("overview");
	const [consoleEntries, setConsoleEntries] = useState<UnityConsoleEntry[]>([]);
	const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
	const [hierarchy, setHierarchy] = useState<UnityHierarchySnapshot | null>(null);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [inspection, setInspection] = useState<UnityGameObjectInspection | null>(null);
	const [testRun, setTestRun] = useState<UnityTestRunStatus | null>(null);
	const [shot, setShot] = useState<UnityScreenshotPayload | null>(null);
	const [doctor, setDoctor] = useState<UnityDoctorReport | null>(null);
	const consoleSeq = useRef(0);
	const snapshotGeneration = useRef(0);
	const snapshotInFlight = useRef<Promise<boolean> | null>(null);
	const pollDelay = useRef(3000);
	const refreshTimers = useRef<number[]>([]);
	const inspectionRequest = useRef(0);
	const lastEditorSelection = useRef<string | null>(null);

	const bridge = snapshot?.bridge ?? null;
	const bridgeSession = bridge?.bridgeStartedAt ?? null;
	const bridgeError = snapshot?.bridgeError ?? null;
	const project = snapshot?.project ?? null;
	const editorPath = editorSelectionPath(bridge?.selection);

	useEffect(() => {
		setSnapshot(null);
		setLoading(true);
		setSnapshotError(null);
		setActionError(null);
		setNotice(null);
		setConsoleEntries([]);
		setHierarchy(null);
		setSelectedPath(null);
		setInspection(null);
		setTestRun(null);
		setShot(null);
		setDoctor(null);
		consoleSeq.current = 0;
		snapshotGeneration.current += 1;
		inspectionRequest.current += 1;
		lastEditorSelection.current = null;
	}, [workspaceId]);

	const loadSnapshot = useCallback((): Promise<boolean> => {
		if (snapshotInFlight.current) return snapshotInFlight.current;
		snapshotGeneration.current += 1;
		const generation = snapshotGeneration.current;
		const pending = hostRequest("unity.snapshot", { workspaceId })
			.then((next) => {
				if (snapshotGeneration.current === generation) {
					setSnapshot(next);
					setSnapshotError(null);
				}
				return true;
			})
			.catch((error: unknown) => {
				if (snapshotGeneration.current === generation) setSnapshotError(errorText(error));
				return false;
			})
			.finally(() => {
				if (snapshotGeneration.current === generation) setLoading(false);
				snapshotInFlight.current = null;
			});
		snapshotInFlight.current = pending;
		return pending;
	}, [workspaceId]);

	const scheduleRefresh = useCallback(
		(delayMs: number) => {
			const timer = window.setTimeout(() => {
				refreshTimers.current = refreshTimers.current.filter((entry) => entry !== timer);
				void loadSnapshot();
			}, delayMs);
			refreshTimers.current.push(timer);
		},
		[loadSnapshot],
	);

	useEffect(() => {
		let disposed = false;
		let timer: number | undefined;
		const tick = () => {
			if (disposed) return;
			void loadSnapshot().then((ok) => {
				if (disposed) return;
				pollDelay.current = ok ? 3000 : Math.min(Math.round(pollDelay.current * 1.7), 30_000);
				timer = window.setTimeout(tick, document.hidden ? 30_000 : pollDelay.current);
			});
		};
		void loadSnapshot().then(() => {
			if (disposed) return;
			timer = window.setTimeout(tick, 3000);
		});
		return () => {
			disposed = true;
			if (timer !== undefined) window.clearTimeout(timer);
		};
	}, [loadSnapshot]);

	useEffect(
		() => () => {
			snapshotGeneration.current += 1;
			snapshotInFlight.current = null;
			for (const timer of refreshTimers.current) window.clearTimeout(timer);
			refreshTimers.current = [];
		},
		[],
	);

	const loadHierarchy = useCallback(async () => {
		try {
			const next = await hostRequest("unity.hierarchy", { workspaceId });
			setHierarchy(next);
		} catch (error) {
			setActionError(errorText(error));
		}
	}, [workspaceId]);

	useEffect(() => {
		if (tab !== "hierarchy" || bridgeSession === null) return;
		void loadHierarchy();
	}, [tab, bridgeSession, loadHierarchy]);

	const loadInspection = useCallback(
		async (path: string) => {
			const request = inspectionRequest.current + 1;
			inspectionRequest.current = request;
			try {
				const next = await hostRequest("unity.inspect", { workspaceId, path });
				if (inspectionRequest.current === request) setInspection(next);
			} catch (error) {
				if (inspectionRequest.current !== request) return;
				setInspection((current) => (current?.path === path ? current : null));
				setActionError(errorText(error));
			}
		},
		[workspaceId],
	);

	useEffect(() => {
		if (!selectedPath) return;
		void loadInspection(selectedPath);
	}, [selectedPath, loadInspection]);

	// Adopt only changes: a panel-initiated `unity.select` echoes back through the host's status cache.
	useEffect(() => {
		if (editorPath === lastEditorSelection.current) return;
		lastEditorSelection.current = editorPath;
		if (editorPath) setSelectedPath(editorPath);
	}, [editorPath]);

	useEffect(() => {
		if (tab !== "console" || bridgeSession === null) return;
		let disposed = false;
		const levels =
			levelFilter === "all"
				? undefined
				: levelFilter === "errors"
					? ERROR_LEVELS
					: (["warning"] as UnityLogLevel[]);
		const poll = (): Promise<void> => {
			return hostRequest("unity.console", {
				workspaceId,
				since: consoleSeq.current,
				limit: 200,
				...(levels ? { levels } : {}),
			})
				.then((page: UnityConsolePage) => {
					if (disposed) return;
					if (page.nextSeq < consoleSeq.current) {
						// The Editor restarted and its Console sequence restarted too: re-read from zero.
						consoleSeq.current = 0;
						void poll();
						return;
					}
					if (page.entries.length > 0) {
						setConsoleEntries((previous) => [...previous, ...page.entries].slice(-500));
					}
					consoleSeq.current = page.nextSeq;
				})
				.catch((error: unknown) => {
					if (!disposed) setActionError(errorText(error));
				});
		};
		void poll();
		const timer = window.setInterval(() => {
			if (!document.hidden) void poll();
		}, 1500);
		return () => {
			disposed = true;
			window.clearInterval(timer);
		};
	}, [tab, workspaceId, levelFilter, bridgeSession]);

	useEffect(() => {
		setConsoleEntries([]);
		consoleSeq.current = 0;
	}, [levelFilter]);

	const capture = useCallback(
		async (view: "game" | "scene" = "game") => {
			try {
				const next = await hostRequest("unity.screenshot", { workspaceId, view, width: 1280 });
				setShot(next);
			} catch (error) {
				setActionError(errorText(error));
			}
		},
		[workspaceId],
	);

	useEffect(() => {
		if (tab !== "game" || !bridge?.isPlaying || shot) return;
		const timer = window.setTimeout(() => void capture("game"), 1200);
		return () => window.clearTimeout(timer);
	}, [tab, bridge?.isPlaying, bridge?.bridgeStartedAt, shot, capture]);

	const runAction = useCallback(
		(label: string, action: () => Promise<void>) => {
			setBusy(label);
			setActionError(null);
			setNotice(null);
			void action()
				.then(() => loadSnapshot())
				.catch((error: unknown) => {
					setActionError(errorText(error));
				})
				.finally(() => {
					setBusy(null);
				});
		},
		[loadSnapshot],
	);

	const compile = useCallback(
		() =>
			runAction("compile", async () => {
				await hostRequest("unity.compile", { workspaceId });
			}),
		[runAction, workspaceId],
	);

	const playmode = useCallback(
		(action: "play" | "stop" | "pause" | "resume" | "step") =>
			runAction(action, async () => {
				await hostRequest("unity.playmode", { workspaceId, action });
				setShot(null);
				if (action === "play") {
					scheduleRefresh(1200);
				}
			}),
		[runAction, workspaceId, scheduleRefresh],
	);

	const openEditor = useCallback(
		() =>
			runAction("open", async () => {
				const result = await hostRequest("unity.openEditor", { workspaceId });
				setNotice(result.started ? t("unity.notice.openingUnity") : t("unity.notice.unityRunning"));
				scheduleRefresh(2000);
			}),
		[runAction, workspaceId, t, scheduleRefresh],
	);

	const installBridge = useCallback(
		() =>
			runAction("install-bridge", async () => {
				setNotice(t("unity.notice.bridgeInstalling"));
				const result = await hostRequest("unity.installBridge", { workspaceId });
				setNotice(
					result.updated ? t("unity.notice.bridgeUpdated") : t("unity.notice.bridgeInstalled"),
				);
				scheduleRefresh(1500);
			}),
		[runAction, workspaceId, t, scheduleRefresh],
	);

	const diagnose = useCallback(
		() =>
			runAction("diagnose", async () => {
				const report = await hostRequest("unity.doctor", { workspaceId });
				setDoctor(report);
			}),
		[runAction, workspaceId],
	);

	const runTests = useCallback(
		(mode: "edit" | "play") =>
			runAction("tests", async () => {
				const run = await hostRequest("unity.tests", { workspaceId, mode });
				setTestRun(run);
				setTab("tests");
			}),
		[runAction, workspaceId],
	);

	const clearConsole = useCallback(
		() =>
			runAction("clear", async () => {
				await hostRequest("unity.clearConsole", { workspaceId });
				setConsoleEntries([]);
				consoleSeq.current = 0;
			}),
		[runAction, workspaceId],
	);

	const selectObject = useCallback(
		(node: UnityHierarchyNode) => {
			setSelectedPath(node.path);
			setTab("inspector");
			void hostRequest("unity.select", { workspaceId, path: node.path }).catch((error: unknown) => {
				setActionError(errorText(error));
			});
		},
		[workspaceId],
	);

	const openScene = useCallback(
		(path: string) =>
			runAction("scene", async () => {
				await hostRequest("unity.open", { workspaceId, path });
			}),
		[runAction, workspaceId],
	);

	const openProjectFile = useCallback(
		(path: string) => {
			if (path.endsWith(".unity")) {
				void openScene(path);
				return;
			}
			void openFileInTab(workspaceId, path, "preview");
		},
		[workspaceId, openScene],
	);

	const error = actionError ?? snapshotError;
	const tabContent = (() => {
		if (loading && !snapshot) {
			return <LoadingRegion rows={6} className="px-8 py-8" />;
		}
		if (!snapshot?.isUnityProject) {
			return (
				<div className="flex h-full items-center justify-center p-16">
					<p className="max-w-md text-center text-text-muted tr-text-ui">
						{t("unity.overview.notUnity")}
					</p>
				</div>
			);
		}
		if (!project) {
			return (
				<div className="flex h-full flex-col items-center justify-center gap-8 p-16">
					<RiErrorWarningLine className="size-16 text-feedback-error" />
					<p className="max-w-md text-center text-text-default tr-text-ui">
						{snapshot.projectError?.code}
					</p>
					<p className="max-w-md break-words text-center text-text-muted tr-text-metadata">
						{snapshot.projectError?.message}
					</p>
					<Button
						variant="outline"
						size="s"
						iconLeft={RiRefreshLine}
						onClick={() => void loadSnapshot()}
					>
						{t("unity.action.refresh")}
					</Button>
				</div>
			);
		}
		switch (tab) {
			case "overview":
				return (
					<ProjectOverview
						project={project}
						bridge={bridge}
						bridgeError={bridgeError}
						bridgeInstalled={snapshot.bridgeInstalled}
						bridgePackageStale={snapshot.bridgePackageStale}
						doctor={doctor}
						onDiagnose={() => void diagnose()}
						onOpenEditor={() => void openEditor()}
						onInstallBridge={() => void installBridge()}
						onCompile={() => void compile()}
						onOpenFile={openProjectFile}
						busy={busy}
					/>
				);
			case "console":
				return (
					<div className="flex h-full min-h-0 flex-col">
						<div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-border-default px-8 py-4">
							{LEVEL_FILTERS.map((filter) => (
								<ToggleSegment
									key={filter.id}
									testid={`unity-console-filter-${filter.id}`}
									label={t(filter.label)}
									active={levelFilter === filter.id}
									onClick={() => setLevelFilter(filter.id)}
								/>
							))}
							<span className="ml-auto text-text-subtle tr-text-metadata">
								{t("unity.console.count", { count: consoleEntries.length })}
							</span>
							<Button
								variant="ghost"
								size="s"
								onClick={() => void clearConsole()}
								disabled={busy !== null || !bridge}
							>
								{t("unity.action.clear")}
							</Button>
						</div>
						<QuietScrollArea className="min-h-0 flex-1" viewportClassName="px-8">
							{consoleEntries.length === 0 ? (
								<p className="py-8 text-text-muted tr-text-metadata">{t("unity.empty.console")}</p>
							) : (
								consoleEntries.map((entry) => <ConsoleRow key={entry.seq} entry={entry} t={t} />)
							)}
						</QuietScrollArea>
					</div>
				);
			case "hierarchy":
				return (
					<div className="flex h-full min-h-0 flex-col">
						<div className="flex shrink-0 items-center gap-8 border-b border-border-default px-8 py-4">
							<span className="min-w-0 flex-1 truncate text-text-default tr-text-metadata">
								{hierarchy ? `${hierarchy.scene} · ${hierarchy.scenePath}` : ""}
							</span>
							<Button
								variant="ghost"
								size="s"
								iconLeft={RiRefreshLine}
								onClick={() => void loadHierarchy()}
								disabled={!bridge}
							>
								{t("unity.action.refresh")}
							</Button>
						</div>
						<QuietScrollArea className="min-h-0 flex-1" viewportClassName="py-4">
							{!hierarchy || hierarchy.roots.length === 0 ? (
								<p className="px-8 py-8 text-text-muted tr-text-metadata">
									{t("unity.empty.hierarchy")}
								</p>
							) : (
								<HierarchyRows
									nodes={hierarchy.roots}
									selectedPath={selectedPath}
									onSelect={selectObject}
								/>
							)}
						</QuietScrollArea>
					</div>
				);
			case "inspector":
				return (
					<QuietScrollArea className="h-full" viewportClassName="px-8 py-8">
						{!inspection ? (
							<p className="text-text-muted tr-text-metadata">{t("unity.empty.inspector")}</p>
						) : (
							<div className="flex flex-col gap-8">
								<div className="flex flex-col gap-2">
									<span className="text-text-default tr-text-ui">{inspection.name}</span>
									<span className="text-text-subtle tr-code-text">{inspection.path}</span>
									<span className="text-text-subtle tr-text-metadata">
										{inspection.scene} · {inspection.tag} · {inspection.layer}
									</span>
								</div>
								<div className="flex flex-col gap-6">
									{inspection.components.map((component) => (
										<div
											key={component.instanceId}
											className="rounded-sm border border-border-default bg-container-elevated-bg"
										>
											<div className="flex items-center gap-4 border-b border-border-default px-8 py-4">
												<span className="text-text-default tr-text-metadata">{component.type}</span>
												{component.enabled ? null : (
													<span className="text-text-subtle tr-text-metadata">
														{t("unity.inspector.disabled")}
													</span>
												)}
											</div>
											{component.properties.length === 0 ? (
												<p className="px-8 py-4 text-text-muted tr-text-metadata">
													{t("unity.inspector.none")}
												</p>
											) : (
												<dl className="flex flex-col">
													{component.properties.map((property) => (
														<div
															key={`${component.instanceId}:${property.name}`}
															className="flex items-start gap-8 border-b border-border-muted px-8 py-2 last:border-b-0"
														>
															<dt className="w-40 shrink-0 truncate text-text-muted tr-text-metadata">
																{property.name}
															</dt>
															<dd className="min-w-0 flex-1 break-words text-text-default tr-code-text">
																{property.value}
															</dd>
														</div>
													))}
												</dl>
											)}
										</div>
									))}
								</div>
							</div>
						)}
					</QuietScrollArea>
				);
			case "game":
				return (
					<div className="flex h-full min-h-0 flex-col">
						<div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-border-default px-8 py-4">
							{bridge?.isPlaying ? (
								<>
									<Button
										variant="outline"
										size="s"
										onClick={() => void playmode("pause")}
										disabled={busy !== null}
									>
										<RiPauseFill className="size-14" />
										{t("unity.action.pause")}
									</Button>
									<Button
										variant="outline"
										size="s"
										onClick={() => void playmode("resume")}
										disabled={busy !== null}
									>
										<RiPlayFill className="size-14" />
										{t("unity.action.resume")}
									</Button>
									<Button
										variant="outline"
										size="s"
										onClick={() => void playmode("step")}
										disabled={busy !== null}
									>
										{t("unity.action.step")}
									</Button>
									<Button
										variant="outline"
										size="s"
										onClick={() => void playmode("stop")}
										disabled={busy !== null}
									>
										<RiStopFill className="size-14" />
										{t("unity.action.stop")}
									</Button>
								</>
							) : (
								<Button
									variant="primary"
									size="s"
									onClick={() => void playmode("play")}
									disabled={busy !== null || !bridge}
								>
									<RiPlayFill className="size-14" />
									{t("unity.action.play")}
								</Button>
							)}
							<Button
								variant="outline"
								size="s"
								iconLeft={RiCameraLine}
								onClick={() => void capture("game")}
								disabled={busy !== null || !bridge}
							>
								{t("unity.action.capture")}
							</Button>
							<Button
								variant="ghost"
								size="s"
								onClick={() => void capture("scene")}
								disabled={busy !== null || !bridge}
							>
								{t("unity.action.captureScene")}
							</Button>
						</div>
						<div className="flex min-h-0 flex-1 items-center justify-center bg-container-content-bg p-8">
							{shot ? (
								<img
									src={`data:${shot.mimeType};base64,${shot.base64}`}
									alt={t("unity.tab.game")}
									className="max-h-full max-w-full object-contain"
								/>
							) : (
								<p className="max-w-sm text-center text-text-muted tr-text-metadata">
									{t("unity.game.editModeHint")}
								</p>
							)}
						</div>
					</div>
				);
			case "tests":
				return (
					<div className="flex h-full min-h-0 flex-col">
						<div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-border-default px-8 py-4">
							<Button
								variant="outline"
								size="s"
								onClick={() => void runTests("edit")}
								disabled={busy !== null || !bridge}
							>
								{t("unity.action.editTests")}
							</Button>
							<Button
								variant="outline"
								size="s"
								onClick={() => void runTests("play")}
								disabled={busy !== null || !bridge}
							>
								{t("unity.action.playTests")}
							</Button>
							{busy === "tests" ? (
								<span className="flex items-center gap-4 text-text-muted tr-text-metadata">
									<RiLoader4Line className="size-14 animate-spin" />
									{t("unity.tests.running")}
								</span>
							) : null}
						</div>
						<QuietScrollArea className="min-h-0 flex-1" viewportClassName="px-8 py-8">
							{!testRun ? (
								<p className="text-text-muted tr-text-metadata">{t("unity.empty.tests")}</p>
							) : (
								<div className="flex flex-col gap-6">
									<div className="flex flex-wrap items-center gap-8">
										<span
											className={cn(
												"tr-text-metadata",
												testRun.state === "failed" || testRun.state === "error"
													? "text-feedback-error"
													: testRun.state === "running"
														? "text-feedback-warning"
														: "text-feedback-success",
											)}
										>
											{testRun.state === "failed"
												? t("unity.tests.state.failed")
												: testRun.state === "error"
													? t("unity.tests.state.error")
													: testRun.state === "running"
														? t("unity.tests.state.running")
														: t("unity.tests.state.passed")}
										</span>
										<span className="text-text-subtle tr-text-metadata">
											{testRun.mode === "play"
												? t("unity.tests.playMode")
												: t("unity.tests.editMode")}
										</span>
										<span className="text-text-subtle tr-text-metadata">
											{t("unity.tests.summary", {
												passed: testRun.passed,
												failed: testRun.failed,
												skipped: testRun.skipped,
											})}
										</span>
									</div>
									{testRun.error ? (
										<p className="text-feedback-error tr-text-metadata">{testRun.error}</p>
									) : null}
									<ul className="flex flex-col">
										{testRun.results.map((result) => (
											<li
												key={`${result.fullName}:${result.name}`}
												className="flex flex-col gap-2 border-b border-border-muted py-4 last:border-b-0"
											>
												<div className="flex items-center gap-4">
													{result.status === "passed" ? (
														<RiCheckboxCircleLine className="size-14 shrink-0 text-feedback-success" />
													) : (
														<RiErrorWarningLine className="size-14 shrink-0 text-feedback-error" />
													)}
													<span className="min-w-0 flex-1 truncate text-text-default tr-text-metadata">
														{result.fullName || result.name}
													</span>
													<span className="text-text-subtle tr-text-metadata">
														{t("unity.units.ms", { value: result.durationMs })}
													</span>
												</div>
												{result.message ? (
													<pre className="whitespace-pre-wrap break-words text-text-subtle tr-code-text">
														{result.message}
													</pre>
												) : null}
											</li>
										))}
									</ul>
								</div>
							)}
						</QuietScrollArea>
					</div>
				);
		}
	})();

	return (
		<div className="flex h-full min-h-0 flex-col bg-container-sidebar-bg">
			<div className="flex h-panel-header-row shrink-0 items-center gap-8 border-b border-border-default px-8">
				<RiGamepadLine className="size-14 shrink-0 text-primary" />
				<div className="flex min-w-0 items-center gap-8">
					<span className="truncate text-text-default tr-text-ui">
						{project?.productName ?? t("workbench.tool.unity")}
					</span>
					{project ? (
						<span className="shrink-0 text-text-subtle tr-text-metadata">
							{project.editorVersion}
						</span>
					) : null}
				</div>
				{snapshot?.isUnityProject ? (
					<span className={cn("ml-4 flex items-center gap-4 tr-text-metadata", statusTone(bridge))}>
						<span className="size-6 rounded-full bg-current" />
						{bridge?.isCompiling
							? t("unity.status.compiling")
							: bridge?.isPlaying
								? bridge.isPaused
									? t("unity.status.paused")
									: t("unity.status.playing")
								: bridge
									? t("unity.status.connected")
									: t("unity.status.disconnected")}
					</span>
				) : null}
				<div className="ml-auto flex items-center gap-2">
					<IconButton
						variant="ghost"
						size="s"
						icon={RiRefreshLine}
						label={t("unity.action.compile")}
						onClick={() => void compile()}
						disabled={busy !== null || !bridge}
					/>
					<IconButton
						variant="ghost"
						size="s"
						icon={bridge?.isPlaying ? RiStopFill : RiPlayFill}
						label={bridge?.isPlaying ? t("unity.action.stop") : t("unity.action.play")}
						onClick={() => void playmode(bridge?.isPlaying ? "stop" : "play")}
						disabled={busy !== null || !bridge}
					/>
					<IconButton
						variant="ghost"
						size="s"
						icon={RiExternalLinkLine}
						label={t("unity.action.openEditor")}
						onClick={() => void openEditor()}
						disabled={busy !== null}
					/>
					<IconButton
						variant="ghost"
						size="s"
						icon={RiRefreshLine}
						label={t("unity.action.refresh")}
						onClick={() => void loadSnapshot()}
					/>
				</div>
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
					<RiInformationLine className="size-14 shrink-0" />
					<span>{notice}</span>
				</div>
			) : null}

			<div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border-default px-8 py-4">
				{TABS.map((entry) => (
					<ToggleSegment
						key={entry.id}
						testid={`unity-tab-${entry.id}`}
						label={t(entry.label)}
						active={tab === entry.id}
						onClick={() => setTab(entry.id)}
					/>
				))}
			</div>

			<div className="min-h-0 flex-1">{tabContent}</div>
		</div>
	);
}
