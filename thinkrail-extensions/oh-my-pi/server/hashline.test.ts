import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
	applyHashlineOps,
	createHashlineEditTool,
	createHashlineReadTool,
	fileTag,
	type HashlineInput,
	resolveToolPath,
	splitSource,
} from "./hashline.ts";

const dirs: string[] = [];

async function workspace(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "oh-my-pi-hashline-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function editTool(dir: string) {
	const tool = createHashlineEditTool(dir);
	return async (input: HashlineInput) => {
		const result = await tool.execute("call", input, undefined, undefined, {
			cwd: dir,
		} as never);
		return { text: (result.content[0] as { text: string }).text, details: result.details };
	};
}

function readTool(dir: string) {
	const tool = createHashlineReadTool(dir);
	return async (input: { path: string; offset?: number; limit?: number }) => {
		const result = await tool.execute("call", input, undefined, undefined, {
			cwd: dir,
		} as never);
		return (result.content[0] as { text: string }).text;
	};
}

describe("hashline edits", () => {
	it("replaces, deletes and inserts by line range", async () => {
		const dir = await workspace();
		const path = join(dir, "file.txt");
		await writeFile(path, "alpha\nbravo\ncharlie\ndelta\n", "utf-8");
		const edit = editTool(dir);

		const replaced = await edit({
			path: "file.txt",
			ops: [
				{ from: 2, to: 2, text: "BRAVO" },
				{ from: 4, to: 3, text: "echo" },
			],
		});
		expect(await readFile(path, "utf-8")).toBe("alpha\nBRAVO\ncharlie\necho\ndelta\n");
		expect(replaced.text).toContain("File tag: ");
		expect(replaced.details.tag).toBe(fileTag("alpha\nBRAVO\ncharlie\necho\ndelta"));

		await edit({ path: "file.txt", ops: [{ from: 3, to: 3, text: "" }] });
		expect(await readFile(path, "utf-8")).toBe("alpha\nBRAVO\necho\ndelta\n");
	});

	it("preserves a BOM and CRLF line endings", async () => {
		const dir = await workspace();
		const path = join(dir, "file.txt");
		await writeFile(path, "\uFEFFone\r\ntwo\r\nthree\r\n", "utf-8");
		const edit = editTool(dir);

		const result = await edit({ path: "file.txt", ops: [{ from: 2, to: 2, text: "TWO" }] });
		expect(await readFile(path, "utf-8")).toBe("\uFEFFone\r\nTWO\r\nthree\r\n");
		expect(result.details.tag).toBe(fileTag("one\nTWO\nthree"));
	});

	it("never duplicates a BOM the model echoes back", async () => {
		const dir = await workspace();
		const path = join(dir, "bom.txt");
		await writeFile(path, "\uFEFFalpha\nbravo\n", "utf-8");

		const read = await readTool(dir)({ path: "bom.txt" });
		expect(read).toContain("    1| alpha");
		expect(read).not.toContain("\uFEFF");

		await editTool(dir)({
			path: "bom.txt",
			tag: fileTag("alpha\nbravo"),
			ops: [{ from: 1, to: 1, text: "\uFEFFALPHA" }],
		});
		expect(await readFile(path, "utf-8")).toBe("\uFEFFALPHA\nbravo\n");
	});

	it("rejects a stale tag and reports the current one", async () => {
		const dir = await workspace();
		const path = join(dir, "file.txt");
		await writeFile(path, "one\ntwo\n", "utf-8");
		const edit = editTool(dir);

		const first = await edit({ path: "file.txt", ops: [{ from: 1, to: 1, text: "ONE" }] });
		await writeFile(path, "changed\n", "utf-8");

		const failure = edit({
			path: "file.txt",
			tag: first.details.tag,
			ops: [{ from: 1, to: 1, text: "AGAIN" }],
		});
		await expect(failure).rejects.toThrow(/File changed since tag .* \(current .*\); re-read/);
	});

	it("rejects unsorted ops instead of repairing them", async () => {
		const dir = await workspace();
		await writeFile(join(dir, "file.txt"), "one\ntwo\nthree\n", "utf-8");
		const edit = editTool(dir);

		await expect(
			edit({
				path: "file.txt",
				ops: [
					{ from: 3, to: 3, text: "THREE" },
					{ from: 1, to: 1, text: "ONE" },
				],
			}),
		).rejects.toThrow(/ops must be sorted by from/);
	});

	it("rejects overlapping and out-of-range ops", async () => {
		const dir = await workspace();
		await writeFile(join(dir, "file.txt"), "one\ntwo\nthree\n", "utf-8");
		const edit = editTool(dir);

		await expect(
			edit({
				path: "file.txt",
				ops: [
					{ from: 1, to: 2, text: "x" },
					{ from: 2, to: 3, text: "y" },
				],
			}),
		).rejects.toThrow(/overlaps the previous op/);
		await expect(edit({ path: "file.txt", ops: [{ from: 4, to: 5, text: "x" }] })).rejects.toThrow(
			/past the end of file.txt \(3 lines\)/,
		);
		await expect(
			edit({
				path: "file.txt",
				ops: [
					{ from: 1, to: 1, text: "x" },
					{ from: 3, to: 1, text: "y" },
				],
			}),
		).rejects.toThrow(/to must be at least from - 1/);
	});

	it("normalizes a source once for validation and reuse", () => {
		const source = splitSource("a\r\nb\r\n");
		expect(source.lines).toEqual(["a", "b"]);
		expect(applyHashlineOps(source, [{ from: 3, to: 2, text: "c" }], "f")).toBe("a\nb\nc");
	});

	it("diffs newline-terminated files against the same base the ops use", async () => {
		const dir = await workspace();
		await writeFile(join(dir, "file.txt"), "1\n2\n3\n4\n5\n", "utf-8");
		const { details } = await editTool(dir)({
			path: "file.txt",
			ops: [{ from: 5, to: 5, text: "five" }],
		});
		expect(details?.diff).toContain("-5 5");
		expect(details?.diff).toContain("+5 five");
		expect(details?.diff).not.toContain("No newline at end of file");
	});

	it("normalizes carriage returns carried in op text", async () => {
		const dir = await workspace();
		const path = join(dir, "file.txt");
		await writeFile(path, "one\r\ntwo\r\nthree\r\n", "utf-8");
		await editTool(dir)({ path: "file.txt", ops: [{ from: 2, to: 2, text: "TWO\r" }] });
		expect(await readFile(path, "utf-8")).toBe("one\r\nTWO\r\nthree\r\n");
	});

	it("takes the line ending from the first line of a mixed file", async () => {
		const dir = await workspace();
		const path = join(dir, "file.txt");
		await writeFile(path, "a\nb\r\nc\n", "utf-8");
		await editTool(dir)({ path: "file.txt", ops: [{ from: 1, to: 1, text: "A" }] });
		expect(await readFile(path, "utf-8")).toBe("A\nb\nc\n");
	});

	it("accepts ops sent as a JSON string or a single op", () => {
		const tool = createHashlineEditTool(process.cwd());
		const prepare = tool.prepareArguments;
		if (!prepare) throw new Error("edit tool lost prepareArguments");
		const single = prepare({ path: "a", ops: { from: 1, to: 1, text: "x" } });
		expect((single as HashlineInput).ops).toEqual([{ from: 1, to: 1, text: "x" }]);
		const encoded = prepare({
			path: "a",
			ops: JSON.stringify([{ from: 2, to: 1, text: "y" }]),
		});
		expect((encoded as HashlineInput).ops).toEqual([{ from: 2, to: 1, text: "y" }]);
	});

	it("reports the lines a delete op removed", async () => {
		const dir = await workspace();
		await writeFile(join(dir, "file.txt"), "a\nb\nc\n", "utf-8");
		const { details } = await editTool(dir)({
			path: "file.txt",
			ops: [{ from: 2, to: 2, text: "" }],
		});
		expect(details?.removed).toEqual([["b"]]);
	});
});

describe("hashline reads", () => {
	it("numbers lines so ops can address them", async () => {
		const dir = await workspace();
		await writeFile(join(dir, "file.txt"), "alpha\nbravo\n", "utf-8");
		const text = await readTool(dir)({ path: "file.txt" });
		expect(text).toContain("    1| alpha");
		expect(text).toContain("    2| bravo");
	});

	it("normalizes paths the way the built-in read does", () => {
		const dir = join(tmpdir(), "probe");
		expect(resolveToolPath(dir, "notes.md")).toBe(join(dir, "notes.md"));
		expect(resolveToolPath(dir, "~/notes.md")).toBe(join(homedir(), "notes.md"));
		expect(resolveToolPath(dir, "@notes.md")).toBe(join(dir, "notes.md"));
	});

	it("accepts file URLs and win32 shell paths", () => {
		const dir = join(tmpdir(), "probe");
		const file = join(dir, "notes.md");
		expect(resolveToolPath(dir, pathToFileURL(file).href)).toBe(file);
		if (sep !== "\\") return;
		expect(resolveToolPath(dir, "/d/Git/thinkrail/biome.json")).toBe(
			"D:\\Git\\thinkrail\\biome.json",
		);
	});

	it("does not number an empty body left by a zero limit", async () => {
		const dir = await workspace();
		await writeFile(join(dir, "a.txt"), "one\ntwo\nthree\n", "utf-8");
		const text = await readTool(dir)({ path: "a.txt", limit: 0 });
		expect(text).not.toContain("    1| ");
		expect(text).toContain("more lines");
	});

	it("reads an empty file as its tag with no numbered lines", async () => {
		const dir = await workspace();
		await writeFile(join(dir, "empty.txt"), "", "utf-8");
		const text = await readTool(dir)({ path: "empty.txt" });
		expect(text).toContain(`File tag: ${fileTag("")}`);
		expect(text).not.toContain("| ");

		await editTool(dir)({
			path: "empty.txt",
			tag: fileTag(""),
			ops: [{ from: 1, to: 0, text: "hello" }],
		});
		expect(await readFile(join(dir, "empty.txt"), "utf-8")).toBe("hello");
	});

	it("floors a fractional offset before numbering", async () => {
		const dir = await workspace();
		await writeFile(join(dir, "a.txt"), "one\ntwo\nthree\n", "utf-8");
		const text = await readTool(dir)({ path: "a.txt", offset: 2.5 });
		expect(text).toContain("    2| two");
		expect(text).not.toContain("  2.5|");
	});

	it("does not number a line past the end of the file", async () => {
		const dir = await workspace();
		await writeFile(join(dir, "a.txt"), "one\ntwo\nthree\n", "utf-8");
		const first = await readTool(dir)({ path: "a.txt", limit: 3 });
		expect(first).toContain("    3| three");
		const past = await readTool(dir)({ path: "a.txt", offset: 4 });
		expect(past).not.toContain("    4| ");
	});

	it("keeps offsets aligned with real line numbers", async () => {
		const dir = await workspace();
		await writeFile(join(dir, "file.txt"), "a\nb\nc\n", "utf-8");
		const text = await readTool(dir)({ path: "file.txt", offset: 2, limit: 1 });
		const [first, , notice] = text.split("\n");
		expect(first).toBe("    2| b");
		expect(notice).toStartWith("[2 more lines");
	});

	it("numbers every line when content itself looks like a read notice", async () => {
		const dir = await workspace();
		await writeFile(
			join(dir, "file.txt"),
			"a\n[2 more lines in file. Use offset=3 to continue.]\nc\n",
			"utf-8",
		);
		const text = await readTool(dir)({ path: "file.txt" });
		const lines = text.split("\n");
		expect(lines[1]).toBe("    2| [2 more lines in file. Use offset=3 to continue.]");
		expect(lines[2]).toBe("    3| c");
	});

	it("keeps numbering when a blank line precedes a notice-shaped line", async () => {
		const dir = await workspace();
		await writeFile(
			join(dir, "file.txt"),
			"a\n\n[2 more lines in file. Use offset=3 to continue.]\nc\n",
			"utf-8",
		);
		const text = await readTool(dir)({ path: "file.txt" });
		const lines = text.split("\n");
		expect(lines[0]).toBe("    1| a");
		expect(lines[2]).toBe("    3| [2 more lines in file. Use offset=3 to continue.]");
		expect(lines[3]).toBe("    4| c");
	});

	it("passes an oversized first line notice through without numbering it", async () => {
		const dir = await workspace();
		await writeFile(join(dir, "f.txt"), `${"x".repeat(60 * 1024)}\n`, "utf-8");
		const text = await readTool(dir)({ path: "f.txt", limit: 1 });
		expect(text).toContain("exceeds");
		expect(text).not.toContain("    1| ");
		expect(text).not.toContain("File tag:");
	});

	it("does not number a phantom line after the trailing newline", async () => {
		const dir = await workspace();
		const path = join(dir, "file.txt");
		await writeFile(path, "alpha\nbravo\ncharlie\n", "utf-8");
		const text = await readTool(dir)({ path: "file.txt" });
		expect(text).not.toContain("    4| ");
		const tag = text.trimEnd().split("File tag: ")[1];
		if (!tag) throw new Error("read did not report a file tag");
		await expect(
			editTool(dir)({ path: "file.txt", tag, ops: [{ from: 3, to: 3, text: "CHARLIE" }] }),
		).resolves.toMatchObject({ details: { tag: fileTag("alpha\nbravo\nCHARLIE") } });
	});

	it("closes with the tag an edit accepts", async () => {
		const dir = await workspace();
		const path = join(dir, "file.txt");
		await writeFile(path, "alpha\nbravo\n", "utf-8");
		const text = await readTool(dir)({ path: "file.txt" });
		const tag = text.trimEnd().split("File tag: ")[1];
		if (!tag) throw new Error("read did not report a file tag");
		expect(tag).toBe(fileTag("alpha\nbravo"));

		const edit = editTool(dir);
		await expect(
			edit({ path: "file.txt", tag, ops: [{ from: 1, to: 1, text: "ALPHA" }] }),
		).resolves.toMatchObject({ details: { tag: fileTag("ALPHA\nbravo") } });
	});
});
