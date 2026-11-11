import { RiPencilLine as Pencil } from "@remixicon/react";
import { type HashlineOp, insertedLines, isHashlineOp } from "@thinkrail/ext-oh-my-pi/web";
import {
	languageFromPath,
	resultText,
	strArg,
	type ToolRenderProps,
} from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { useHighlightedCode } from "@/lib/highlightCode";
import { Collapsible } from "./Collapsible";
import { highlightedLines } from "./highlightedLines";
import { ToolFileLink } from "./ToolFileLink";

export function EditCard({
	toolCallId,
	args,
	result,
	status,
	workspaceRoot,
	onOpenFile,
}: ToolRenderProps) {
	const path = strArg(args, "path");
	const oldText = strArg(args, "oldText") || strArg(args, "old_string") || strArg(args, "old");
	const newText = strArg(args, "newText") || strArg(args, "new_string") || strArg(args, "new");
	const ops = hashlineOps(args);
	const removedOps = hashlineRemoved(result);
	const lang = languageFromPath(path);
	const message = resultText(result);

	if (status === "error") {
		return (
			<div data-testid="tool-edit" className="flex flex-col gap-4">
				<EditHeader
					path={path}
					workspaceRoot={workspaceRoot}
					onOpenFile={onOpenFile}
					disabled={true}
				/>
				<pre className="overflow-auto px-8 py-4 text-feedback-error tr-code-text">{message}</pre>
			</div>
		);
	}

	const oldLines = oldText ? oldText.split("\n") : [];
	const newLines = newText ? newText.split("\n") : [];
	const opLines = ops.reduce((total, op) => total + insertedLines(op.text).length, 0);
	return (
		<div data-testid="tool-edit" className="flex flex-col gap-4">
			<EditHeader
				path={path}
				workspaceRoot={workspaceRoot}
				onOpenFile={onOpenFile}
				disabled={status !== "done"}
			/>
			{ops.length > 0 ? (
				<Collapsible
					id={`${toolCallId}:content`}
					lines={opLines + removedOps.reduce((total, lines) => total + lines.length, 0)}
					fadeClass="bg-[linear-gradient(to_top,var(--container-elevated-bg),transparent)]"
				>
					<div className="overflow-auto rounded-sm border border-border-default tr-code-text leading-relaxed">
						{ops.map((op, index) => {
							const key = `op-${index}`;
							const label = op.to < op.from ? String(op.from) : `${op.from}–${op.to}`;
							const removed = removedOps[index] ?? [];
							return (
								<div key={key} className="border-border-muted border-t first:border-t-0">
									<div className="bg-container-elevated-bg px-8 py-2 select-none text-text-muted tr-code-text">
										{label}
									</div>
									{removed.length > 0 ? (
										<DiffLines code={removed.join("\n")} lang={lang} sign="−" tone="remove" />
									) : null}
									<DiffLines
										code={insertedLines(op.text).join("\n")}
										lang={lang}
										sign="+"
										tone="add"
									/>
								</div>
							);
						})}
					</div>
				</Collapsible>
			) : (
				<Collapsible
					id={`${toolCallId}:content`}
					lines={oldLines.length + newLines.length}
					fadeClass="bg-[linear-gradient(to_top,var(--container-elevated-bg),transparent)]"
				>
					<div className="overflow-auto rounded-sm border border-border-default tr-code-text leading-relaxed">
						{oldLines.length > 0 ? (
							<DiffLines code={oldText} lang={lang} sign="−" tone="remove" />
						) : null}
						{newLines.length > 0 ? (
							<DiffLines code={newText} lang={lang} sign="+" tone="add" />
						) : null}
					</div>
				</Collapsible>
			)}
		</div>
	);
}

function DiffLines({
	code,
	lang,
	sign,
	tone,
}: {
	code: string;
	lang: string;
	sign: string;
	tone: "add" | "remove";
}) {
	const plain = code === "" ? [] : (code.endsWith("\n") ? code.slice(0, -1) : code).split("\n");
	const html = useHighlightedCode(code, lang);
	const rows = html === null ? null : highlightedLines(html);
	const tokens = rows && rows.length === plain.length ? rows : null;
	const background = tone === "add" ? "bg-feedback-success-subtle" : "bg-feedback-error-subtle";
	const marker = tone === "add" ? "text-feedback-success-muted" : "text-feedback-error-muted";
	const text = tone === "add" ? "text-feedback-success" : "text-feedback-error";
	return (
		<>
			{plain.map((line, index) => (
				<div key={index} className={`flex ${background}`}>
					<span className={`w-24 shrink-0 select-none px-4 text-right ${marker}`}>{sign}</span>
					{tokens ? (
						<pre
							className="min-w-0 flex-1 px-4 tr-code-text"
							dangerouslySetInnerHTML={{ __html: tokens[index] || " " }}
						/>
					) : (
						<pre className={`min-w-0 flex-1 px-4 tr-code-text ${text}`}>{line}</pre>
					)}
				</div>
			))}
		</>
	);
}

function hashlineOps(args: Record<string, unknown>): HashlineOp[] {
	let ops = args.ops;
	if (typeof ops === "string") {
		try {
			ops = JSON.parse(ops);
		} catch {
			return [];
		}
	}
	if (isHashlineOp(ops)) return [ops];
	if (!Array.isArray(ops)) return [];
	return ops.filter(isHashlineOp);
}

function hashlineRemoved(result: unknown): string[][] {
	if (typeof result !== "object" || result === null || !("details" in result)) return [];
	const details = (result as { details: unknown }).details;
	if (typeof details !== "object" || details === null) return [];
	const removed = (details as Record<string, unknown>).removed;
	if (!Array.isArray(removed)) return [];
	return removed.map((entry) =>
		Array.isArray(entry) ? entry.filter((line): line is string => typeof line === "string") : [],
	);
}

function EditHeader({
	path,
	workspaceRoot,
	onOpenFile,
	disabled,
}: {
	path: string;
	workspaceRoot?: string | undefined;
	onOpenFile?: ((path: string) => void) | undefined;
	disabled: boolean;
}) {
	const t = useT();
	return (
		<div className="flex items-center gap-4 tr-text-metadata">
			<Pencil className="size-12 shrink-0 text-feedback-warning" />
			<ToolFileLink
				path={path}
				workspaceRoot={workspaceRoot}
				onOpenFile={onOpenFile}
				disabled={disabled}
				className="text-text-default"
			/>
			<span className="shrink-0 text-text-muted">{t("tools.edit.edited")}</span>
		</div>
	);
}
