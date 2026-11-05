import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { readDir, readFile, workspaceRelativePath } from "./files";

let dataDir: string;
let root: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-fs-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	root = join(dataDir, "worktree");
	mkdirSync(join(root, "src", "auth"), { recursive: true });
	writeFileSync(join(root, "src", "auth", "login.ts"), "export {};\n");
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([{ id: "w1", projectId: "p1", name: "w1", worktreePath: root, createdAt: 1 }]),
	);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("readDir reports worktree-relative paths with forward slashes on every platform", () => {
	expect(readDir("w1", ".").map((node) => node.path)).toEqual(["src"]);
	expect(readDir("w1", "src").map((node) => node.path)).toEqual(["src/auth"]);
	expect(readDir("w1", "src/auth").map((node) => node.path)).toEqual(["src/auth/login.ts"]);
});

test("workspaceRelativePath names a contained path worktree-relative with / separators", () => {
	expect(workspaceRelativePath(root, join(root, "src", "auth", "login.ts"))).toBe(
		"src/auth/login.ts",
	);
	expect(workspaceRelativePath(root, join("src", "auth", "login.ts"))).toBe("src/auth/login.ts");
	expect(workspaceRelativePath(root, "./src/../src/auth")).toBe("src/auth");
	expect(workspaceRelativePath(`${root}${sep}.`, "src")).toBe("src");
	expect(workspaceRelativePath(root, "..env")).toBe("..env");
	expect(workspaceRelativePath(root, ".")).toBe("");
});

test("workspaceRelativePath rejects a path outside the worktree", () => {
	expect(workspaceRelativePath(root, "../worktree-sibling/a.ts")).toBeNull();
	expect(workspaceRelativePath(root, join(dataDir, "elsewhere"))).toBeNull();
});

test("a linked Git repository outside the worktree stays readable through its link path", () => {
	const business = join(dataDir, "business");
	mkdirSync(join(business, ".git"), { recursive: true });
	writeFileSync(join(business, "code.ts"), "export {};\n");
	symlinkSync(business, join(root, "Game"), process.platform === "win32" ? "junction" : "dir");

	expect(readDir("w1", ".").find((node) => node.name === "Game")?.kind).toBe("dir");
	expect(readDir("w1", "Game").map((node) => node.path)).toContain("Game/code.ts");
	expect(readFile("w1", "Game/code.ts").content).toBe("export {};\n");
});

test("a link outside the worktree that is not a Git repository is still rejected", () => {
	const outside = join(dataDir, "outside");
	mkdirSync(outside);
	writeFileSync(join(outside, "secret.txt"), "secret\n");
	symlinkSync(outside, join(root, "outside"), process.platform === "win32" ? "junction" : "dir");

	expect(() => readDir("w1", "outside")).toThrow("Path escapes the worktree");
	expect(() => readFile("w1", "outside/secret.txt")).toThrow("Path escapes the worktree");
});
