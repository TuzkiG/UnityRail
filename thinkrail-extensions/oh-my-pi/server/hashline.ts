import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createReadToolDefinition,
	generateDiffString,
	generateUnifiedPatch,
	type ReadToolDetails,
	type ToolDefinition,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { type HashlineOp, insertedLines, isHashlineOp } from "../shared/ops.ts";

export type { HashlineOp } from "../shared/ops.ts";

export interface HashlineDetails {
	diff: string;
	patch: string;
	firstChangedLine: number | undefined;
	tag: string;
	/** Lines each op removed, aligned with the requested ops; empty for pure insertions. */
	removed: string[][];
}

const hashlineOpSchema = Type.Object({
	from: Type.Integer({
		description: "First 1-based line number to replace, or the line to insert before.",
	}),
	to: Type.Integer({
		description: "Last 1-based line number to replace. Use from - 1 to insert before from.",
	}),
	text: Type.String({ description: "Replacement lines. An empty string deletes the range." }),
});

const hashlineSchema = Type.Object({
	path: Type.String({ description: "Path to the file to edit." }),
	tag: Type.Optional(
		Type.String({
			description:
				"File tag reported by the previous read or edit of this file. The edit is rejected when the file changed since that tag.",
		}),
	),
	ops: Type.Array(hashlineOpSchema, {
		minItems: 1,
		description: "Line-range operations, sorted by from and never overlapping.",
	}),
});

export type HashlineInput = Static<typeof hashlineSchema>;

/** Short content hash the model carries between reads and edits. */
export function fileTag(normalizedContent: string): string {
	return createHash("sha256").update(normalizedContent).digest("hex").slice(0, 8);
}

/** Canonical tag of a file: the normalized content without its trailing newline. */
export function sourceTag(source: SourceFile): string {
	return fileTag(source.lines.join("\n"));
}

export interface SourceFile {
	bom: string;
	ending: "\n" | "\r\n";
	normalized: string;
	lines: string[];
	trailingNewline: boolean;
}

export function splitSource(rawContent: string): SourceFile {
	const bom = rawContent.startsWith("\uFEFF") ? "\uFEFF" : "";
	const text = bom ? rawContent.slice(1) : rawContent;
	const firstNewline = text.indexOf("\n");
	const ending = firstNewline > 0 && text[firstNewline - 1] === "\r" ? "\r\n" : "\n";
	const normalized = text.replace(/\r\n/g, "\n");
	const trailingNewline = normalized.endsWith("\n");
	const lines = normalized === "" ? [] : normalized.split("\n");
	if (trailingNewline) lines.pop();
	return { bom, ending, normalized, lines, trailingNewline };
}

function restore(source: SourceFile, content: string): string {
	const withEnding = source.ending === "\r\n" ? content.replace(/\n/g, "\r\n") : content;
	return `${source.bom}${withEnding}${source.trailingNewline ? source.ending : ""}`;
}

function stripLeadingBom(text: string): string {
	return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

/** Some models send ops as a JSON string or a single op instead of an array. */
export function prepareHashlineArguments(input: unknown): HashlineInput {
	if (!input || typeof input !== "object") return input as HashlineInput;
	const args = input as Record<string, unknown>;
	if (typeof args.ops === "string") {
		try {
			const parsed: unknown = JSON.parse(args.ops);
			if (Array.isArray(parsed)) args.ops = parsed;
			else if (isHashlineOp(parsed)) args.ops = [parsed];
		} catch {}
	} else if (isHashlineOp(args.ops)) {
		args.ops = [args.ops];
	}
	return args as HashlineInput;
}

/** Validates ops against the source and returns the rewritten LF-normalized content. */
export function applyHashlineOps(
	source: SourceFile,
	ops: readonly HashlineOp[],
	path: string,
): string {
	if (ops.length === 0) throw new Error("hashline edit needs at least one op.");
	const lineCount = source.lines.length;
	for (let index = 1; index < ops.length; index += 1) {
		const current = ops[index];
		const previous = ops[index - 1];
		if (!current || !previous) continue;
		if (current.from < previous.from) {
			throw new Error(`ops must be sorted by from; ops[${index}] starts before ops[${index - 1}].`);
		}
	}
	let previousEnd = 0;
	for (const [index, op] of ops.entries()) {
		if (!Number.isInteger(op.from) || !Number.isInteger(op.to)) {
			throw new Error(`ops[${index}]: from and to must be whole line numbers.`);
		}
		if (op.from < 1) throw new Error(`ops[${index}]: from must be at least 1.`);
		if (op.to < op.from - 1) {
			throw new Error(`ops[${index}]: to must be at least from - 1.`);
		}
		if (op.to > lineCount) {
			throw new Error(
				`ops[${index}]: line ${op.to} is past the end of ${path} (${lineCount} lines).`,
			);
		}
		if (op.from > lineCount + 1) {
			throw new Error(
				`ops[${index}]: line ${op.from} is past the end of ${path} (${lineCount} lines).`,
			);
		}
		if (op.from <= previousEnd) {
			throw new Error(
				`ops[${index}] overlaps the previous op; sort ops by line and keep ranges disjoint.`,
			);
		}
		previousEnd = op.to;
	}
	const lines = [...source.lines];
	for (const op of [...ops].reverse()) {
		const start = op.from - 1;
		lines.splice(start, op.to - op.from + 1, ...insertedLines(op.text));
	}
	return stripLeadingBom(lines.join("\n"));
}

export function createHashlineEditTool(
	cwd: string,
): ToolDefinition<typeof hashlineSchema, HashlineDetails> {
	return {
		name: "edit",
		label: "edit",
		description:
			"Edit a single file by line range. Read the file first, then send ops that reference the reported file tag. Every op replaces lines from..to (1-based, inclusive) with text; from - 1 inserts before from and an empty text deletes the range. Ops must be sorted and must not overlap.",
		promptSnippet: "Edit a file by line range, anchored by the file content tag",
		promptGuidelines: [
			"Read a file before editing it, then edit by line range instead of repeating its text.",
			"Send the file tag from the previous read or edit; when it no longer matches, re-read the file and retry.",
			"Keep ops sorted by from and non-overlapping; merge nearby changes into one op.",
		],
		parameters: hashlineSchema,
		prepareArguments: prepareHashlineArguments,
		renderShell: "self",
		async execute(_toolCallId, input, signal, _onUpdate, ctx) {
			const absolutePath = resolveToolPath(ctx?.cwd || cwd, input.path);
			return withFileMutationQueue(absolutePath, async () => {
				const throwIfAborted = () => {
					if (signal?.aborted) throw new Error("Operation aborted");
				};
				throwIfAborted();
				const rawContent = await readFile(absolutePath, "utf-8").catch((error: unknown) => {
					const code = error instanceof Error && "code" in error ? ` ${String(error.code)}.` : "";
					throw new Error(`Could not edit file: ${input.path}.${code}`);
				});
				throwIfAborted();
				const source = splitSource(rawContent);
				const currentTag = sourceTag(source);
				if (input.tag !== undefined && input.tag !== currentTag) {
					throw new Error(
						`File changed since tag ${input.tag} (current ${currentTag}); re-read the affected region and retry.`,
					);
				}
				const newContent = applyHashlineOps(source, input.ops, input.path);
				const removed = input.ops.map((op) =>
					op.to >= op.from ? source.lines.slice(op.from - 1, op.to) : [],
				);
				await writeFile(absolutePath, restore(source, newContent), "utf-8");
				throwIfAborted();
				const before = source.lines.join("\n");
				const diff = generateDiffString(before, newContent);
				const tag = fileTag(newContent);
				return {
					content: [
						{
							type: "text",
							text: `Successfully applied ${input.ops.length} op(s) to ${input.path}. File tag: ${tag}.`,
						},
					],
					details: {
						diff: diff.diff,
						patch: generateUnifiedPatch(input.path, before, newContent),
						firstChangedLine: diff.firstChangedLine,
						tag,
						removed,
					},
				};
			});
		},
	};
}

const UNICODE_SPACES = /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g;

function normalizeWindowsShellPath(filePath: string): string {
	if (sep !== "\\" || !filePath.startsWith("/") || filePath.startsWith("//")) return filePath;
	if (filePath.includes("\\")) return filePath;
	const match = filePath.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
	if (!match) return filePath;
	const suffix = match[2]?.replaceAll("/", "\\");
	return `${match[1]?.toUpperCase()}:\\${suffix ?? ""}`;
}

/** Mirrors the SDK's `resolveToCwd`, so both tools accept the paths the built-in read accepts. */
export function resolveToolPath(cwd: string, filePath: string): string {
	let normalized = filePath.replace(UNICODE_SPACES, " ");
	if (normalized.startsWith("@")) normalized = normalized.slice(1);
	normalized = normalizeWindowsShellPath(normalized);
	const home = homedir();
	if (normalized === "~") return home;
	if (normalized.startsWith("~/") || (sep === "\\" && normalized.startsWith("~\\"))) {
		normalized = join(home, normalized.slice(2));
	}
	if (/^file:\/\//.test(normalized)) normalized = fileURLToPath(normalized);
	return isAbsolute(normalized) ? resolve(normalized) : resolve(cwd, normalized);
}

const NOTICE_TAIL =
	/\n\n\[(?:(?:Showing lines \d+-\d+ of \d+(?: \([^\]]*\))?\.)|(?:Truncated)|(?:\d+ more lines? in file))[^\n\]]*\]$/;
const FIRST_LINE_NOTICE = /^\[Line \d+ is [^\]]*exceeds [^\]]* limit\. Use bash: [^\]]*\]$/;

type ReadParameters = ReturnType<typeof createReadToolDefinition>["parameters"];

/** Numbers the lines a read returns and closes with the file tag, so the model can address and anchor edits. */
export function createHashlineReadTool(
	cwd: string,
): ToolDefinition<ReadParameters, ReadToolDetails | undefined> {
	const read = createReadToolDefinition(cwd);
	return {
		name: read.name,
		label: read.label,
		description: read.description,
		parameters: read.parameters,
		promptSnippet: "Read file contents with line numbers and a file tag",
		promptGuidelines: [
			"Use read to examine files instead of cat or sed.",
			"The leading number of each line is its line number for the edit tool.",
			"Pass the trailing file tag as tag when you edit the file; a changed tag means the lines moved.",
		],
		async execute(toolCallId, input, signal, onUpdate, ctx) {
			const absolutePath = resolveToolPath(ctx?.cwd || cwd, input.path);
			const rawLimit = input.limit;
			const limit =
				rawLimit === undefined || !Number.isFinite(rawLimit)
					? rawLimit
					: Math.max(0, Math.floor(rawLimit));
			const readInput = limit === undefined ? input : { ...input, limit };
			return withFileMutationQueue(absolutePath, async () => {
				const result = await read.execute(toolCallId, readInput, signal, onUpdate, ctx);
				if (result.content.some((block) => block.type !== "text")) return result;
				const source = await readFile(absolutePath, "utf-8").then(
					(raw) => splitSource(raw),
					() => undefined,
				);
				const tag = source === undefined ? undefined : sourceTag(source);
				const requestedOffset = Number(input.offset ?? 1);
				const offset = Number.isFinite(requestedOffset)
					? Math.max(1, Math.floor(requestedOffset))
					: 1;
				return {
					...result,
					content: result.content.map((block) => {
						if (block.type !== "text") return block;
						if (FIRST_LINE_NOTICE.test(block.text)) return block;
						if (source !== undefined && offset > Math.max(1, source.lines.length)) return block;
						const match = block.text.match(NOTICE_TAIL);
						const body = stripLeadingBom(match ? block.text.slice(0, match.index) : block.text);
						const tail = match ? block.text.slice(match.index) : "";
						if (match && body === "") return block;
						if (body === "") {
							const trailer = tag === undefined ? "" : `${tail ? "\n\n" : ""}File tag: ${tag}`;
							return { ...block, text: tail + trailer };
						}
						let line = offset;
						const bodyLines = body.split("\n");
						if (body.endsWith("\n")) bodyLines.pop();
						const numbered = bodyLines.map((text) => {
							const label = String(line).padStart(5, " ");
							line += 1;
							return `${label}| ${text}`;
						});
						const trailer = tag === undefined ? "" : `\n\nFile tag: ${tag}`;
						return { ...block, text: numbered.join("\n") + tail + trailer };
					}),
				};
			});
		},
	};
}
