import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodedError } from "@thinkrail/shared/codedError";
import { listMemoryNotes, readMemoryNote, saveMemoryNote } from "./notes";

const savedDir = process.env.BASIC_MEMORY_DIR;
let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "trpi-memory-notes-"));
	process.env.BASIC_MEMORY_DIR = root;
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (savedDir === undefined) delete process.env.BASIC_MEMORY_DIR;
	else process.env.BASIC_MEMORY_DIR = savedDir;
});

function writeNote(rel: string, content: string, mtimeMs?: number): void {
	const abs = join(root, rel);
	mkdirSync(join(abs, ".."), { recursive: true });
	writeFileSync(abs, content, "utf8");
	if (mtimeMs !== undefined) {
		utimesSync(abs, new Date(mtimeMs), new Date(mtimeMs));
	}
}

describe("memory notes", () => {
	test("lists Markdown notes newest first with frontmatter titles", () => {
		writeNote("home/older.md", "# older", 1000);
		writeNote("home/newer.md", '---\ntitle: "Newer Title"\ntags: [a]\n---\n\n# Newer', 2000);
		writeNote("home/ignored.txt", "not a note");
		writeNote(".hidden/secret.md", "hidden");
		const snapshot = listMemoryNotes();
		expect(snapshot.root).toBe(root);
		expect(snapshot.exists).toBe(true);
		expect(snapshot.notes.map((note) => note.path)).toEqual(["home/newer.md", "home/older.md"]);
		expect(snapshot.notes[0]?.title).toBe("Newer Title");
		expect(snapshot.notes[1]?.title).toBe("older");
	});

	test("reports a missing notes root", () => {
		rmSync(root, { recursive: true, force: true });
		const snapshot = listMemoryNotes();
		expect(snapshot.exists).toBe(false);
		expect(snapshot.notes).toEqual([]);
	});

	test("reads a note", () => {
		writeNote("home/read.md", "# read me");
		expect(readMemoryNote("home/read.md")).toEqual({ content: "# read me" });
	});

	test("rejects a path that escapes the notes root", () => {
		expect(() => readMemoryNote("../outside.md")).toThrow(CodedError);
		expect(() => saveMemoryNote("..\\outside.md", "x")).toThrow(CodedError);
	});

	test("rejects a non-Markdown path", () => {
		writeNote("home/plain.txt", "text");
		expect(() => readMemoryNote("home/plain.txt")).toThrow(CodedError);
	});

	test("saves a note over its existing content", () => {
		writeNote("home/save.md", "# before");
		expect(saveMemoryNote("home/save.md", "# after")).toEqual({ ok: true });
		expect(readMemoryNote("home/save.md")).toEqual({ content: "# after" });
	});

	test("rejects saving a note that does not exist", () => {
		expect(() => saveMemoryNote("home/nope.md", "# new")).toThrow(CodedError);
	});
});
