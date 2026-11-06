import {
	RiErrorWarningLine as Alert,
	RiCheckboxCircleLine as Check,
	RiLoader4Line as Loader,
	RiPlayLine as Play,
	RiRefreshLine as Refresh,
	RiStopCircleLine as Skip,
} from "@remixicon/react";
import type { UnityTestResult, VerificationRun } from "@thinkrail/contracts";
import { localeOf, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useCallback, useEffect, useState } from "react";
import { QuietScrollArea } from "@/components/QuietScrollArea";
import { workspaceFileTarget } from "../chat/fileTargets";
import { selectWorkspaceById, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { openFileInTab } from "./openTabs";
import { type TestFrame, testFrames } from "./verifyFrames";

const MAX_RUNS = 20;

function statusTone(result: UnityTestResult): string {
	if (result.status === "passed") return "text-feedback-success";
	if (result.status === "skipped") return "text-text-muted";
	if (result.status === "inconclusive") return "text-feedback-warning";
	return "text-feedback-error";
}

function StatusGlyph({ result }: { result: UnityTestResult }) {
	if (result.status === "passed") {
		return <Check className="size-14 shrink-0 text-feedback-success" aria-hidden />;
	}
	if (result.status === "skipped") {
		return <Skip className="size-14 shrink-0 text-text-muted" aria-hidden />;
	}
	return <Alert className={cn("size-14 shrink-0", statusTone(result))} aria-hidden />;
}

function formatTime(t: ReturnType<typeof useT>, at: number): string {
	try {
		return new Intl.DateTimeFormat(localeOf(t), {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		}).format(new Date(at));
	} catch {
		return String(at);
	}
}

/**
 * Verification surface: the Unity test runs this workspace performed, newest first, with the failing
 * test's own stack frames turned into links. A run is recorded by the host whenever `unity.tests`
 * answers, so a run started from the chat tool and one started here share the history.
 */
export function VerifyPanel({ workspaceId }: { workspaceId: string }) {
	const t = useT();
	const workspace = useAppStore((state) => selectWorkspaceById(state, workspaceId));
	const [runs, setRuns] = useState<VerificationRun[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [filter, setFilter] = useState("");
	const [busy, setBusy] = useState<"edit" | "play" | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const history = await getTransport().request("verification.list", { workspaceId });
			setRuns(history.runs.slice(0, MAX_RUNS));
			setSelectedId((current) => current ?? history.runs[0]?.id ?? null);
		} catch {
			setRuns([]);
		}
	}, [workspaceId]);

	useEffect(() => {
		setSelectedId(null);
		void load();
	}, [load]);

	const run = async (mode: "edit" | "play") => {
		if (busy !== null) return;
		setBusy(mode);
		setError(null);
		try {
			const result = await getTransport().request("unity.tests", {
				workspaceId,
				mode,
				...(filter.trim() ? { filter: filter.trim() } : {}),
			});
			await load();
			setSelectedId((current) => current ?? null);
			if (result.state === "error" && result.error) setError(result.error);
		} catch (failure) {
			setError(errorText(failure));
		} finally {
			setBusy(null);
		}
	};

	const selected = runs.find((entry) => entry.id === selectedId) ?? runs[0] ?? null;
	const openFrame = (frame: TestFrame) => {
		const target = workspaceFileTarget(frame.path, workspace?.worktreePath ?? "");
		if (target === null) return;
		void openFileInTab(workspaceId, target, "preview", null, frame.line);
	};

	return (
		<div data-testid="verify-panel" className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-wrap items-center gap-4 border-border-default border-b px-8 py-4">
				<Button
					size="s"
					variant="outline"
					data-testid="verify-run-edit"
					disabled={busy !== null}
					onClick={() => void run("edit")}
				>
					{t("verify.run.edit")}
				</Button>
				<Button
					size="s"
					variant="outline"
					data-testid="verify-run-play"
					disabled={busy !== null}
					onClick={() => void run("play")}
				>
					{t("verify.run.play")}
				</Button>
				<input
					data-testid="verify-filter"
					value={filter}
					onChange={(event) => setFilter(event.currentTarget.value)}
					placeholder={t("verify.filter.placeholder")}
					className="h-24 min-w-0 flex-1 rounded-sm border border-control-border-default bg-control-bg px-8 text-text-default tr-text-metadata"
				/>
				<IconAction onClick={() => void load()} label={t("verify.refresh")} />
				{busy !== null ? (
					<span className="flex items-center gap-4 text-text-muted tr-text-metadata">
						<Loader className="size-14 animate-spin" />
						{t("verify.running")}
					</span>
				) : null}
			</div>
			{error ? (
				<p data-testid="verify-error" className="px-8 py-4 text-feedback-error tr-text-metadata">
					{error}
				</p>
			) : null}
			<div className="flex min-h-0 flex-1">
				<QuietScrollArea className="w-160 shrink-0" viewportClassName="py-4">
					{selected ? null : (
						<p data-testid="verify-empty" className="px-8 py-4 text-text-muted tr-text-metadata">
							{t("verify.empty")}
						</p>
					)}
					<ul className="flex flex-col">
						{runs.map((entry) => (
							<li key={entry.id}>
								<button
									type="button"
									data-testid="verify-run-row"
									data-run-id={entry.id}
									data-active={entry.id === selected?.id ? true : undefined}
									onClick={() => setSelectedId(entry.id)}
									className={cn(
										"flex w-full min-w-0 flex-col items-start gap-2 border-border-muted border-b px-8 py-4 text-left hover:bg-control-bg-hovered",
										entry.id === selected?.id && "bg-control-bg-selected",
									)}
								>
									<span className="flex w-full items-center gap-4">
										<Play className="size-12 shrink-0 text-text-muted" aria-hidden />
										<span className="tr-text-metadata text-text-default">
											{entry.run.mode === "play" ? t("verify.mode.play") : t("verify.mode.edit")}
										</span>
										<span className="ml-auto text-text-subtle tr-text-metadata">
											{formatTime(t, entry.createdAt)}
										</span>
									</span>
									<span className="flex w-full items-center gap-4 tr-text-metadata">
										<span className="text-feedback-success">{entry.run.passed}</span>
										<span className="text-feedback-error">{entry.run.failed}</span>
										<span className="text-text-subtle">{entry.run.skipped}</span>
										{entry.filter ? (
											<span className="truncate text-text-subtle">{entry.filter}</span>
										) : null}
									</span>
								</button>
							</li>
						))}
					</ul>
				</QuietScrollArea>
				<QuietScrollArea
					className="min-w-0 flex-1 border-border-default border-l"
					viewportClassName="p-8"
				>
					{selected ? <RunDetail run={selected} onOpenFrame={openFrame} /> : null}
				</QuietScrollArea>
			</div>
		</div>
	);
}

function IconAction({ label, onClick }: { label: string; onClick: () => void }) {
	return <IconButton icon={Refresh} label={label} variant="ghost" onClick={onClick} />;
}

function RunDetail({
	run,
	onOpenFrame,
}: {
	run: VerificationRun;
	onOpenFrame: (frame: TestFrame) => void;
}) {
	const t = useT();
	const { run: status } = run;
	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap items-center gap-8">
				<span
					className={cn(
						"tr-text-metadata",
						status.state === "failed" || status.state === "error"
							? "text-feedback-error"
							: status.state === "running"
								? "text-feedback-warning"
								: "text-feedback-success",
					)}
				>
					{status.state === "failed"
						? t("verify.state.failed")
						: status.state === "error"
							? t("verify.state.error")
							: status.state === "running"
								? t("verify.state.running")
								: t("verify.state.passed")}
				</span>
				<span className="text-text-subtle tr-text-metadata">
					{t("verify.summary", {
						passed: status.passed,
						failed: status.failed,
						skipped: status.skipped,
					})}
				</span>
				{status.durationMs !== undefined ? (
					<span className="text-text-subtle tr-text-metadata">
						{t("verify.duration", { value: Math.round(status.durationMs) })}
					</span>
				) : null}
			</div>
			{status.error ? <p className="text-feedback-error tr-text-metadata">{status.error}</p> : null}
			{run.resultsTruncated ? (
				<p className="text-feedback-warning tr-text-metadata">{t("verify.truncated")}</p>
			) : null}
			<ul className="flex flex-col">
				{status.results.map((result) => (
					<li
						key={`${result.fullName}:${result.name}`}
						data-testid="verify-result"
						data-status={result.status}
						className="flex flex-col gap-2 border-border-muted border-b py-4 last:border-b-0"
					>
						<div className="flex items-center gap-4">
							<StatusGlyph result={result} />
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
						{testFrames(result.stackTrace).length > 0 ? (
							<div className="flex flex-wrap gap-4">
								{testFrames(result.stackTrace).map((frame) => (
									<button
										key={`${frame.path}:${frame.line}`}
										type="button"
										data-testid="verify-frame"
										onClick={() => onOpenFrame(frame)}
										className="max-w-full truncate rounded-sm border border-border-default px-6 py-2 text-text-subtle tr-text-metadata hover:text-text-default"
										title={`${frame.path}:${frame.line}`}
									>
										{frame.path}:{frame.line}
									</button>
								))}
							</div>
						) : null}
					</li>
				))}
			</ul>
		</div>
	);
}
