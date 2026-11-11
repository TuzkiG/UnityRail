import type { Dirent } from "node:fs";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { MemoryNoteSummary, MemoryNotesSnapshot } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";

const MAX_NOTES = 500;
const MAX_NOTE_BYTES = 1024 * 1024;
const NOTE_EXTENSION = ".md";

/** The Basic Memory notes root: `BASIC_MEMORY_DIR`, else `~/basic-memory`. */
export function memoryNotesDir(): string {
	const override = process.env.BASIC_MEMORY_DIR?.trim();
	return override || join(homedir(), "basic-memory");
}

/** One project's folder name inside the shared root: its slug, filesystem-safe. */
export function memoryProjectDirName(project: { slug?: string; name: string }): string {
	const raw = (project.slug || project.name).trim().toLowerCase();
	const safe = raw.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return safe || "project";
}

/** Absolute folder holding one project's notes. */
export function projectMemoryDir(project: { slug?: string; name: string }): string {
	return join(memoryNotesDir(), memoryProjectDirName(project));
}

function notePath(root: string, requested: string): string {
	if (typeof requested !== "string" || requested.trim().length === 0) {
		throw new CodedError("MEMORY_NOTE_NOT_FOUND", "a note path is required");
	}
	const abs = resolve(root, requested);
	const rel = relative(root, abs);
	if (rel === "" || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		throw new CodedError("MEMORY_NOTE_OUTSIDE_ROOT", `note escapes the notes root: ${requested}`);
	}
	if (!abs.toLowerCase().endsWith(NOTE_EXTENSION)) {
		throw new CodedError("MEMORY_NOTE_NOT_FOUND", `not a Markdown note: ${requested}`);
	}
	return abs;
}

function frontmatterTitle(content: string, fallback: string): string {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
	if (!match) return fallback;
	const title = /^title:\s*(.+)$/m.exec(match[1] ?? "");
	const raw = title?.[1]?.trim();
	const value = typeof raw === "string" ? raw.replace(/^["']|["']$/g, "") : "";
	return value || fallback;
}

function collectNotes(
	root: string,
	directory: string,
	limit: number,
	accumulator: MemoryNoteSummary[],
	excludeDirs: ReadonlySet<string>,
): void {
	if (accumulator.length >= limit) return;
	let entries: Dirent[];
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (accumulator.length >= limit) return;
		if (entry.name.startsWith(".")) continue;
		const abs = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (directory === root && excludeDirs.has(entry.name)) continue;
			collectNotes(root, abs, limit, accumulator, excludeDirs);
			continue;
		}
		if (!entry.isFile() || !entry.name.toLowerCase().endsWith(NOTE_EXTENSION)) continue;
		const rel = relative(root, abs).split(sep).join("/");
		const stat = statSync(abs);
		const fallback = entry.name.slice(0, -NOTE_EXTENSION.length);
		const title = frontmatterTitle(readFileSync(abs, "utf8"), fallback);
		accumulator.push({ path: rel, title, size: stat.size, updatedAt: stat.mtimeMs });
	}
}

/** Which tree a notes request addresses: the shared root, or one project's folder under it. */
export interface MemoryNotesScope {
	/** Absolute folder the note paths are relative to; defaults to the shared root. */
	dir?: string;
	/** The project folder under the shared root, echoed back on a project scope. */
	projectFolder?: string;
	/** Direct child folders of the shared root that belong to a project, so the user scope skips them. */
	excludeDirs?: readonly string[];
}

/** Lists the newest Markdown notes under the Basic Memory notes root. */
export function listMemoryNotes(scope: MemoryNotesScope = {}): MemoryNotesSnapshot {
	const root = scope.dir ?? memoryNotesDir();
	const base = {
		root,
		scope: scope.dir ? ("project" as const) : ("user" as const),
		...(scope.projectFolder ? { projectFolder: scope.projectFolder } : {}),
	};
	if (!existsSync(root)) return { ...base, exists: false, notes: [] };
	const notes: MemoryNoteSummary[] = [];
	collectNotes(root, root, MAX_NOTES, notes, new Set(scope.excludeDirs ?? []));
	notes.sort((a, b) => b.updatedAt - a.updatedAt);
	return { ...base, exists: true, notes: notes.slice(0, MAX_NOTES) };
}

/** Reads one note's Markdown source. */
export function readMemoryNote(
	requested: string,
	scope: MemoryNotesScope = {},
): { content: string } {
	const abs = notePath(scope.dir ?? memoryNotesDir(), requested);
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(abs);
	} catch {
		throw new CodedError("MEMORY_NOTE_NOT_FOUND", `note not found: ${requested}`);
	}
	if (!stat.isFile()) throw new CodedError("MEMORY_NOTE_NOT_FOUND", `not a note: ${requested}`);
	if (stat.size > MAX_NOTE_BYTES) {
		throw new CodedError("MEMORY_NOTE_TOO_LARGE", `note is larger than ${MAX_NOTE_BYTES} bytes`);
	}
	return { content: readFileSync(abs, "utf8") };
}

/** Overwrites one note's Markdown source; the MCP server picks the change up from disk. */
export function saveMemoryNote(
	requested: string,
	content: string,
	scope: MemoryNotesScope = {},
): { ok: true } {
	if (typeof content !== "string") {
		throw new CodedError("MEMORY_NOTE_INVALID", "note content must be text");
	}
	if (Buffer.byteLength(content, "utf8") > MAX_NOTE_BYTES) {
		throw new CodedError("MEMORY_NOTE_TOO_LARGE", `note is larger than ${MAX_NOTE_BYTES} bytes`);
	}
	const abs = notePath(scope.dir ?? memoryNotesDir(), requested);
	if (!existsSync(dirname(abs))) {
		throw new CodedError("MEMORY_NOTE_NOT_FOUND", `note not found: ${requested}`);
	}
	writeFileSync(abs, content, "utf8");
	return { ok: true };
}
