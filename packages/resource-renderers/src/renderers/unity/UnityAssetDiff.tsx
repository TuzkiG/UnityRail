import {
	RiChat3Line as Comment,
	RiArrowLeftRightLine as DiffIcon,
	RiDeleteBinLine as Minus,
	RiAddLine as Plus,
} from "@remixicon/react";
import type { UnityAssetObjectChange, UnityAssetObjectRef } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { type ComponentType, lazy, Suspense, useEffect, useMemo, useState } from "react";
import type {
	AnchorDraft,
	ResourceDiffProps,
	ResourceSemanticDiff,
	ReviewThread,
} from "../../registry";
import { ReviewComposer } from "../../support/ReviewComposer";
import { ReviewThreadCard } from "../../support/ReviewThreadCard";

const SourceDiff: ComponentType<ResourceDiffProps> = lazy(() => import("../code/PierreDiff"));

const SECTION_LABEL = {
	added: "viewer.unity.added",
	removed: "viewer.unity.removed",
	changed: "viewer.unity.changed",
} as const;

function unityDiff(semantic: ResourceSemanticDiff | undefined) {
	return semantic?.kind === "unity-asset" ? semantic.unityAsset : null;
}

function threadLine(thread: ReviewThread): number | null {
	for (const selector of thread.anchor.selectors) {
		if (selector.kind === "lineRange") return selector.startLine;
	}
	return null;
}

function objectSummary(object: UnityAssetObjectRef): string {
	return object.path === "" || object.path === object.name ? object.name : `${object.path}`;
}

function ObjectHeader({
	object,
	tone,
	onComment,
}: {
	object: UnityAssetObjectRef;
	tone: "added" | "removed" | "changed";
	onComment?: (() => void) | undefined;
}) {
	const t = useT();
	const marker =
		tone === "added" ? (
			<Plus className="size-12 shrink-0 text-feedback-success" aria-hidden />
		) : tone === "removed" ? (
			<Minus className="size-12 shrink-0 text-feedback-error" aria-hidden />
		) : (
			<DiffIcon className="size-12 shrink-0 text-text-muted" aria-hidden />
		);
	return (
		<div
			data-testid="unity-object"
			data-tone={tone}
			data-file-id={object.fileId}
			className="flex h-panel-row items-center gap-8 border-border-default border-b px-8"
		>
			{marker}
			<span className="shrink-0 rounded-sm border border-border-default px-4 py-2 text-text-subtle tr-text-metadata">
				{object.type}
			</span>
			<span className="min-w-0 flex-1 truncate text-text-default tr-text-ui">
				{objectSummary(object)}
			</span>
			<span className="shrink-0 text-text-subtle tr-text-metadata">#{object.fileId}</span>
			<span className="shrink-0 text-text-subtle tr-text-metadata">L{object.line}</span>
			{onComment ? (
				<IconButton
					icon={Comment}
					label={t("viewer.unity.comment")}
					variant="ghost"
					data-testid="unity-object-comment"
					onClick={onComment}
				/>
			) : null}
		</div>
	);
}

function FieldChange({ change }: { change: UnityAssetObjectChange["fields"][number] }) {
	return (
		<div
			data-testid="unity-field"
			data-field={change.field}
			className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-8 border-border-default border-b px-8 py-2 tr-text-metadata last:border-b-0"
		>
			<code className="truncate text-text-muted tr-code-text" title={change.field}>
				{change.field}
			</code>
			<span className="truncate text-feedback-error" title={change.before}>
				{change.before === "" ? "—" : change.before}
			</span>
			<span className="truncate text-feedback-success" title={change.after}>
				{change.after === "" ? "—" : change.after}
			</span>
		</div>
	);
}

/**
 * Unity YAML is unreadable as text, so a `.unity`/`.prefab`/`.asset` diff shows the object model the
 * host derived (GameObject/component identity, transform path, field values) with an escape hatch to
 * the raw source. Comments anchor to the object's document line, which is what the review system
 * already knows how to resolve.
 */
export default function UnityAssetDiff(props: ResourceDiffProps) {
	const t = useT();
	const semantic = unityDiff(props.semantic);
	const [mode, setMode] = useState<"semantic" | "source">(semantic ? "semantic" : "source");
	const [composer, setComposer] = useState<{ line: number; label: string } | null>(null);
	const worktree = props.review?.worktree;
	const diff = semantic;

	const threadsByLine = useMemo(() => {
		const map = new Map<number, ReviewThread[]>();
		for (const thread of worktree?.threads ?? []) {
			const line = threadLine(thread);
			if (line === null) continue;
			const list = map.get(line);
			if (list) list.push(thread);
			else map.set(line, [thread]);
		}
		return map;
	}, [worktree?.threads]);

	const placed = useMemo(() => {
		if (diff === null) return undefined;
		const lines = new Set<number>();
		for (const object of [...diff.added, ...diff.changed.map((change) => change.object)]) {
			lines.add(object.line);
		}
		const ids = new Set<string>();
		for (const [line, threads] of threadsByLine) {
			if (!lines.has(line)) continue;
			for (const thread of threads) ids.add(thread.id);
		}
		return ids;
	}, [diff, threadsByLine]);

	useEffect(() => {
		if (placed === undefined) return;
		props.onPlacedThreadIds?.(placed);
	});

	if (mode === "source" || diff === null) {
		return (
			<Suspense fallback={null}>
				<SourceDiff {...props} />
			</Suspense>
		);
	}

	const openComposer = (object: UnityAssetObjectRef) =>
		setComposer({
			line: object.line,
			label: `${object.type} ${objectSummary(object)}`,
		});
	const draftFor = (line: number, label: string): AnchorDraft => ({
		selectors: [{ kind: "lineRange", startLine: line, endLine: line }],
		label,
	});
	const renderThreads = (line: number) => {
		const threads = threadsByLine.get(line);
		if (!threads || threads.length === 0 || !worktree) return null;
		return (
			<div className="flex flex-col gap-4 border-border-default border-b px-8 py-4">
				{threads.map((thread) => (
					<ReviewThreadCard key={thread.id} thread={thread} actions={worktree.actions} />
				))}
			</div>
		);
	};

	const sections: Array<{ key: "added" | "removed" | "changed"; items: React.ReactNode }> = [];
	if (diff.added.length > 0) {
		sections.push({
			key: "added",
			items: diff.added.map((object) => (
				<div key={object.fileId}>
					<ObjectHeader
						object={object}
						tone="added"
						onComment={worktree ? () => openComposer(object) : undefined}
					/>
					{renderThreads(object.line)}
				</div>
			)),
		});
	}
	if (diff.removed.length > 0) {
		sections.push({
			key: "removed",
			items: diff.removed.map((object) => (
				<ObjectHeader key={object.fileId} object={object} tone="removed" />
			)),
		});
	}
	if (diff.changed.length > 0) {
		sections.push({
			key: "changed",
			items: diff.changed.map((change) => (
				<div key={change.object.fileId}>
					<ObjectHeader
						object={change.object}
						tone="changed"
						onComment={worktree ? () => openComposer(change.object) : undefined}
					/>
					{change.fields.map((field) => (
						<FieldChange key={field.field} change={field} />
					))}
					{renderThreads(change.object.line)}
				</div>
			)),
		});
	}

	return (
		<div data-testid="unity-asset-diff" className="flex h-full min-h-0 flex-col">
			<div className="flex h-panel-row shrink-0 items-center gap-8 border-border-default border-b px-8">
				<span data-testid="unity-asset-summary" className="tr-text-metadata text-text-subtle">
					{t("viewer.unity.summary", {
						added: diff.added.length,
						removed: diff.removed.length,
						changed: diff.changed.length,
					})}
				</span>
				{diff.truncated ? (
					<span className="text-feedback-warning tr-text-metadata">
						{t("viewer.unity.truncated")}
					</span>
				) : null}
				<div className="ml-auto flex items-center gap-2">
					<button
						type="button"
						data-testid="unity-mode-semantic"
						data-active={mode === "semantic" ? true : undefined}
						onClick={() => setMode("semantic")}
						className={cn(
							"rounded-sm px-6 py-2 tr-text-metadata",
							mode === "semantic"
								? "bg-control-bg-selected text-text-default"
								: "text-text-subtle hover:text-text-default",
						)}
					>
						{t("viewer.unity.semantic")}
					</button>
					<button
						type="button"
						data-testid="unity-mode-source"
						onClick={() => setMode("source")}
						className="rounded-sm px-6 py-2 text-text-subtle tr-text-metadata hover:text-text-default"
					>
						{t("viewer.unity.source")}
					</button>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				{sections.length === 0 ? (
					<p className="px-12 py-12 text-text-muted tr-text-metadata">{t("viewer.unity.empty")}</p>
				) : null}
				{sections.map((section) => (
					<section key={section.key} data-testid={`unity-section-${section.key}`}>
						<h3 className="sticky top-0 z-10 bg-container-content-bg px-8 py-4 tr-text-eyebrow text-text-subtle">
							{t(SECTION_LABEL[section.key], {
								count:
									section.key === "added"
										? diff.added.length
										: section.key === "removed"
											? diff.removed.length
											: diff.changed.length,
							})}
						</h3>
						{section.items}
					</section>
				))}
				{composer && worktree ? (
					<div className="border-border-default border-t p-8">
						<ReviewComposer
							draft={draftFor(composer.line, composer.label)}
							label={composer.label}
							commenting={worktree.commenting}
							onClose={() => setComposer(null)}
						/>
					</div>
				) : null}
			</div>
		</div>
	);
}
