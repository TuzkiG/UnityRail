/** One hash-anchored replacement: replace lines `from..to` (inclusive, 1-based) with `text`. */
export interface HashlineOp {
	from: number;
	to: number;
	text: string;
}

export function isHashlineOp(value: unknown): value is HashlineOp {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.from === "number" && typeof entry.to === "number" && typeof entry.text === "string"
	);
}

/**
 * Lines an op writes: a trailing newline is layout, and op text copied from a CRLF read loses its `\r`.
 * Shared with the edit card so the rows shown match the rows written.
 */
export function insertedLines(text: string): string[] {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r$/, "");
	if (normalized === "") return [];
	const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
	return trimmed.split("\n");
}
