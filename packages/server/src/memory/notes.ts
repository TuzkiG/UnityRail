import type { Dirent } from "node:fs";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { MemoryNoteSummary, MemoryNotesSnapshot, MemoryProject } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { memoryProject } from "./config";

const MAX_NOTES = 500;
const MAX_NOTE_BYTES = 1024 * 1024;
const NOTE_EXTENSION = ".md";

/** Resolves a Basic Memory project name to its folder, or fails with a coded error. */
export function requireMemoryProject(name: string): MemoryProject {
	const project = memoryProject(name);
	if (!project) {
		throw new CodedError("MEMORY_PROJECT_NOT_FOUND", `unknown Basic Memory project: ${name}`);
	}
	return project;
}

function notePath(root: string, requested: string): string {
	if (typeof requested !== "string" || requested.trim().length === 0) {
		throw new CodedError("MEMORY_NOTE_NOT_FOUND", "a note path is required");
	}
	const abs = resolve(root, requested);
	const rel = relative(root, abs);
	if (rel === "" || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		throw new CodedError(
			"MEMORY_NOTE_OUTSIDE_ROOT",
			`note escapes the project folder: ${requested}`,
		);
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
			collectNotes(root, abs, limit, accumulator);
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

/** Lists the newest Markdown notes in one Basic Memory project's folder. */
export function listMemoryNotes(projectName: string): MemoryNotesSnapshot {
	const project = requireMemoryProject(projectName);
	const root = project.path;
	if (!existsSync(root)) {
		return { project: project.name, root, exists: false, notes: [] };
	}
	const notes: MemoryNoteSummary[] = [];
	collectNotes(root, root, MAX_NOTES, notes);
	notes.sort((a, b) => b.updatedAt - a.updatedAt);
	return { project: project.name, root, exists: true, notes: notes.slice(0, MAX_NOTES) };
}

/** Reads one note's Markdown source. */
export function readMemoryNote(projectName: string, requested: string): { content: string } {
	const abs = notePath(requireMemoryProject(projectName).path, requested);
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

/** Overwrites one note's Markdown source; Basic Memory indexes the file from disk. */
export function saveMemoryNote(
	projectName: string,
	requested: string,
	content: string,
): { ok: true } {
	if (typeof content !== "string") {
		throw new CodedError("MEMORY_NOTE_INVALID", "note content must be text");
	}
	if (Buffer.byteLength(content, "utf8") > MAX_NOTE_BYTES) {
		throw new CodedError("MEMORY_NOTE_TOO_LARGE", `note is larger than ${MAX_NOTE_BYTES} bytes`);
	}
	const abs = notePath(requireMemoryProject(projectName).path, requested);
	if (!existsSync(dirname(abs))) {
		throw new CodedError("MEMORY_NOTE_NOT_FOUND", `note not found: ${requested}`);
	}
	writeFileSync(abs, content, "utf8");
	return { ok: true };
}

/** The folder a note lives in, for tests and the reveal action. */
export function memoryNoteDir(projectName: string): string {
	return requireMemoryProject(projectName).path;
}
