import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodedError } from "@thinkrail/shared/codedError";
import { listMemoryNotes, readMemoryNote, saveMemoryNote } from "./notes";

const savedConfigDir = process.env.BASIC_MEMORY_CONFIG_DIR;
let configDir: string;
let notesDir: string;

beforeEach(() => {
	configDir = mkdtempSync(join(tmpdir(), "trpi-bm-config-"));
	notesDir = mkdtempSync(join(tmpdir(), "trpi-bm-notes-"));
	process.env.BASIC_MEMORY_CONFIG_DIR = configDir;
	writeFileSync(
		join(configDir, "config.json"),
		JSON.stringify({ default_project: "main", projects: { main: { path: notesDir } } }),
		"utf8",
	);
});

afterEach(() => {
	rmSync(configDir, { recursive: true, force: true });
	rmSync(notesDir, { recursive: true, force: true });
	if (savedConfigDir === undefined) delete process.env.BASIC_MEMORY_CONFIG_DIR;
	else process.env.BASIC_MEMORY_CONFIG_DIR = savedConfigDir;
});

function writeNote(rel: string, content: string, mtimeMs?: number): void {
	const abs = join(notesDir, rel);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content, "utf8");
	if (mtimeMs !== undefined) utimesSync(abs, new Date(mtimeMs), new Date(mtimeMs));
}

describe("memory notes", () => {
	test("lists Markdown notes newest first with frontmatter titles", () => {
		writeNote("notes/older.md", "# older", 1000);
		writeNote("notes/newer.md", '---\ntitle: "Newer Title"\n---\n\n# Newer', 2000);
		writeNote("notes/ignored.txt", "not a note");
		writeNote(".hidden/secret.md", "hidden");
		const snapshot = listMemoryNotes("main");
		expect(snapshot.project).toBe("main");
		expect(snapshot.root).toBe(notesDir);
		expect(snapshot.exists).toBe(true);
		expect(snapshot.notes.map((note) => note.path)).toEqual(["notes/newer.md", "notes/older.md"]);
		expect(snapshot.notes[0]?.title).toBe("Newer Title");
		expect(snapshot.notes[1]?.title).toBe("older");
	});

	test("reports a project folder that does not exist yet", () => {
		rmSync(notesDir, { recursive: true, force: true });
		const snapshot = listMemoryNotes("main");
		expect(snapshot.exists).toBe(false);
		expect(snapshot.notes).toEqual([]);
	});

	test("rejects an unknown project", () => {
		expect(() => listMemoryNotes("nope")).toThrow(CodedError);
	});

	test("reads, saves and re-reads a note", () => {
		writeNote("notes/read.md", "# read me");
		expect(readMemoryNote("main", "notes/read.md")).toEqual({ content: "# read me" });
		expect(saveMemoryNote("main", "notes/read.md", "# changed")).toEqual({ ok: true });
		expect(readMemoryNote("main", "notes/read.md")).toEqual({ content: "# changed" });
	});

	test("rejects paths that escape the project folder or are not Markdown", () => {
		writeNote("notes/plain.txt", "text");
		expect(() => readMemoryNote("main", "../outside.md")).toThrow(CodedError);
		expect(() => saveMemoryNote("main", "..\\outside.md", "x")).toThrow(CodedError);
		expect(() => readMemoryNote("main", "notes/plain.txt")).toThrow(CodedError);
	});

	test("rejects saving a note that does not exist", () => {
		expect(() => saveMemoryNote("main", "notes/nope.md", "# new")).toThrow(CodedError);
	});
});
