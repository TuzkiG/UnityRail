import { RiErrorWarningLine, RiLoader4Line } from "@remixicon/react";
import type {
	UnityCompileStatus,
	UnityConsolePage,
	UnityHierarchyNode,
	UnityHierarchySnapshot,
	UnityLogLevel,
	UnityTestRunStatus,
	UnityVerifyDetails,
} from "@thinkrail/contracts";
import { resultText, strArg, type ToolRenderProps } from "@thinkrail/extension-api/web";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";

const LEVEL_KEYS: Record<UnityLogLevel, MessageKey> = {
	error: "unity.console.level.error",
	warning: "unity.console.level.warning",
	log: "unity.console.level.log",
	exception: "unity.console.level.exception",
	assert: "unity.console.level.assert",
};

function detailsOf<T>(result: unknown): T | null {
	if (!result || typeof result !== "object" || !("details" in result)) return null;
	const details = (result as { details?: unknown }).details;
	return details && typeof details === "object" ? (details as T) : null;
}

function statusTone(status: string): string {
	return status === "failed" || status === "error"
		? "text-feedback-error"
		: status === "running" || status === "compiling"
			? "text-feedback-warning"
			: "text-feedback-success";
}

function PlainResult({ result }: { result: unknown }) {
	return (
		<pre className="whitespace-pre-wrap break-words text-text-default tr-code-text">
			{resultText(result)}
		</pre>
	);
}

function CompileBody({ compile }: { compile: UnityCompileStatus }) {
	const t = useT();
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-8">
				<span className={cn("tr-text-metadata", statusTone(compile.state))}>
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
			</div>
			{compile.diagnostics.length === 0 ? (
				<p className="text-text-muted tr-text-metadata">{t("unity.tool.noDiagnostics")}</p>
			) : (
				<ul className="flex flex-col">
					{compile.diagnostics.slice(0, 20).map((diagnostic) => (
						<li
							key={`${diagnostic.file}:${diagnostic.line}:${diagnostic.message}`}
							className="flex flex-col gap-2 border-b border-border-muted py-4 last:border-b-0"
						>
							<span
								className={cn(
									"tr-text-metadata",
									diagnostic.severity === "error" ? "text-feedback-error" : "text-feedback-warning",
								)}
							>
								{diagnostic.severity === "error"
									? t("unity.severity.error")
									: t("unity.severity.warning")}
							</span>
							<span className="break-all text-text-subtle tr-code-text">
								{diagnostic.file}
								{diagnostic.line ? `:${diagnostic.line}` : ""}
							</span>
							<span className="whitespace-pre-wrap break-words text-text-default tr-code-text">
								{diagnostic.message}
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function ConsoleBody({ page }: { page: UnityConsolePage }) {
	const t = useT();
	if (page.entries.length === 0) {
		return <p className="text-text-muted tr-text-metadata">{t("unity.tool.noEntries")}</p>;
	}
	return (
		<ul className="flex flex-col">
			{page.entries.slice(0, 20).map((entry) => (
				<li
					key={entry.seq}
					className="flex flex-col gap-2 border-b border-border-muted py-4 last:border-b-0"
				>
					<div className="flex items-center gap-8">
						<span
							className={cn(
								"tr-text-metadata",
								entry.level === "error" || entry.level === "exception" || entry.level === "assert"
									? "text-feedback-error"
									: entry.level === "warning"
										? "text-feedback-warning"
										: "text-text-muted",
							)}
						>
							{t(LEVEL_KEYS[entry.level])}
						</span>
						<span className="text-text-subtle tr-text-metadata">#{entry.seq}</span>
					</div>
					<span className="whitespace-pre-wrap break-words text-text-default tr-code-text">
						{entry.message}
					</span>
				</li>
			))}
		</ul>
	);
}

function TestsBody({ run }: { run: UnityTestRunStatus }) {
	const t = useT();
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-8">
				<span className={cn("tr-text-metadata", statusTone(run.state))}>
					{run.state === "failed"
						? t("unity.tests.state.failed")
						: run.state === "error"
							? t("unity.tests.state.error")
							: run.state === "running"
								? t("unity.tests.state.running")
								: t("unity.tests.state.passed")}
				</span>
				<span className="text-text-subtle tr-text-metadata">
					{t("unity.tests.summary", {
						passed: run.passed,
						failed: run.failed,
						skipped: run.skipped,
					})}
				</span>
			</div>
			{run.error ? <p className="text-feedback-error tr-text-metadata">{run.error}</p> : null}
			{run.results.length === 0 ? (
				<p className="text-text-muted tr-text-metadata">{t("unity.tool.noTests")}</p>
			) : (
				<ul className="flex flex-col">
					{run.results.slice(0, 30).map((result) => (
						<li
							key={`${result.fullName}:${result.name}`}
							className="flex flex-col gap-2 border-b border-border-muted py-4 last:border-b-0"
						>
							<div className="flex items-center gap-4">
								<RiErrorWarningLine
									className={cn(
										"size-14 shrink-0",
										result.status === "passed" ? "text-feedback-success" : "text-feedback-error",
									)}
								/>
								<span className="min-w-0 flex-1 truncate text-text-default tr-text-metadata">
									{result.fullName || result.name}
								</span>
							</div>
							{result.message ? (
								<span className="whitespace-pre-wrap break-words text-text-subtle tr-code-text">
									{result.message}
								</span>
							) : null}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

interface HierarchyRow {
	node: UnityHierarchyNode;
	depth: number;
}

function flattenHierarchy(
	nodes: readonly UnityHierarchyNode[],
	depth: number,
	rows: HierarchyRow[],
	limit: number,
): void {
	for (const node of nodes) {
		if (rows.length >= limit) return;
		rows.push({ node, depth });
		if (depth < 12) flattenHierarchy(node.children, depth + 1, rows, limit);
	}
}

function HierarchyBody({ snapshot }: { snapshot: UnityHierarchySnapshot }) {
	const t = useT();
	if (snapshot.roots.length === 0) {
		return <p className="text-text-muted tr-text-metadata">{t("unity.empty.hierarchy")}</p>;
	}
	const rows: HierarchyRow[] = [];
	flattenHierarchy(snapshot.roots, 0, rows, 60);
	return (
		<div className="flex max-h-80 flex-col gap-2 overflow-auto">
			<span className="text-text-muted tr-text-metadata">
				{snapshot.scene} · {snapshot.scenePath}
			</span>
			<ul className="flex flex-col">
				{rows.map(({ node, depth }) => (
					<li
						key={`${node.instanceId}:${node.path}`}
						className={cn("flex flex-col", depth > 0 && "ml-8 border-l border-border-muted pl-4")}
					>
						<span
							className={cn(
								"truncate text-text-default tr-code-text",
								!node.activeInHierarchy && "text-text-disabled",
							)}
							title={node.path}
						>
							{node.name}
						</span>
						{node.components.length > 0 ? (
							<span className="truncate text-text-subtle tr-text-metadata">
								{node.components.map((component) => component.type).join(", ")}
							</span>
						) : null}
					</li>
				))}
			</ul>
			{snapshot.truncated || rows.length >= 60 ? (
				<span className="text-text-subtle tr-text-metadata">
					{t("unity.tool.more", { count: rows.length })}
				</span>
			) : null}
		</div>
	);
}

function VerifyBody({ verify }: { verify: UnityVerifyDetails }) {
	const t = useT();
	return (
		<div className="flex flex-col gap-8">
			<CompileBody compile={verify.compile} />
			{verify.tests ? <TestsBody run={verify.tests} /> : null}
			{verify.console ? <ConsoleBody page={verify.console} /> : null}
			{verify.screenshot ? (
				<span className="text-text-subtle tr-text-metadata">
					{t("unity.tool.screenshot.summary", {
						view: verify.screenshot.view,
						width: verify.screenshot.width,
						height: verify.screenshot.height,
					})}
				</span>
			) : null}
		</div>
	);
}

export function UnityToolCard(props: ToolRenderProps): ReactNode {
	const t = useT();
	const { toolName, result, status, args } = props;
	if (status === "running") {
		return (
			<div className="flex items-center gap-4 text-text-muted tr-text-metadata">
				<RiLoader4Line className="size-14 animate-spin motion-reduce:animate-none" />
				<span>{resultText(result)}</span>
			</div>
		);
	}
	if (status === "error") {
		return (
			<div className="flex flex-col gap-2">
				<span className="text-feedback-error tr-text-metadata">{t("unity.tool.failed")}</span>
				<pre className="whitespace-pre-wrap break-words text-text-default tr-code-text">
					{resultText(result)}
				</pre>
			</div>
		);
	}
	switch (toolName) {
		case "unity_compile": {
			const compile = detailsOf<UnityCompileStatus>(result);
			return compile ? <CompileBody compile={compile} /> : <PlainResult result={result} />;
		}
		case "unity_console": {
			const page = detailsOf<UnityConsolePage>(result);
			return page ? <ConsoleBody page={page} /> : <PlainResult result={result} />;
		}
		case "unity_tests": {
			const run = detailsOf<UnityTestRunStatus>(result);
			return run ? <TestsBody run={run} /> : <PlainResult result={result} />;
		}
		case "unity_verify": {
			const verify = detailsOf<UnityVerifyDetails>(result);
			return verify ? <VerifyBody verify={verify} /> : <PlainResult result={result} />;
		}
		case "unity_screenshot":
			return <p className="text-text-muted tr-text-metadata">{t("unity.tool.screenshot.label")}</p>;
		case "unity_hierarchy": {
			const hierarchy = detailsOf<UnityHierarchySnapshot>(result);
			return hierarchy ? <HierarchyBody snapshot={hierarchy} /> : <PlainResult result={result} />;
		}
		case "unity_find": {
			const assets = detailsOf<Array<{ path: string; type: string }>>(result);
			return assets ? (
				<ul className="flex flex-col">
					{assets.slice(0, 30).map((asset) => (
						<li
							key={asset.path}
							className="flex items-center gap-4 border-b border-border-muted py-2 last:border-b-0"
						>
							<span className="min-w-0 flex-1 truncate text-text-default tr-code-text">
								{asset.path}
							</span>
							<span className="text-text-subtle tr-text-metadata">{asset.type}</span>
						</li>
					))}
				</ul>
			) : (
				<PlainResult result={result} />
			);
		}
		case "unity_open":
			return <p className="text-text-default tr-text-metadata">{strArg(args, "path")}</p>;
		case "unity_select":
			return <p className="text-text-default tr-text-metadata">{strArg(args, "path")}</p>;
		case "unity_open_editor":
			return <PlainResult result={result} />;
		default:
			return <PlainResult result={result} />;
	}
}
