import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { revertChange } from "../changes";
import { hashBytes } from "../fs";
import {
	gitCommitPaths,
	gitDiffFile,
	gitStatus,
	gitUncommittedPaths,
	listNestedRepoStatuses,
	repoForPath,
} from ".";

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
		stdout: "ignore",
		stderr: "ignore",
	});
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

function gitOut(cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
	return new TextDecoder().decode(result.stdout).trim();
}

function initRepoAt(path: string, files: Record<string, string>): string {
	mkdirSync(path);
	git(path, "init", "-b", "main");
	git(path, "config", "user.email", "t@thinkrail.test");
	git(path, "config", "user.name", "test");
	git(path, "config", "commit.gpgsign", "false");
	for (const [file, content] of Object.entries(files)) {
		const abs = join(path, file);
		mkdirSync(join(abs, ".."), { recursive: true });
		writeFileSync(abs, content);
	}
	git(path, "add", "-A");
	git(path, "commit", "-m", "init");
	return path;
}

function makeRepo(name: string, files: Record<string, string>): string {
	return initRepoAt(join(dataDir, name), files);
}

function addSubmodule(parent: string, url: string, path: string): void {
	git(parent, "config", "protocol.file.allow", "always");
	git(parent, "-c", "protocol.file.allow=always", "submodule", "add", "-q", url, path);
	git(parent, "commit", "-m", `add ${path}`);
}

function seedWorkspace(): void {
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "w1",
				projectId: "p1",
				name: "w1",
				branch: "main",
				worktreePath: repo,
				baseBranch: "main",
				createdAt: 1,
			},
		]),
	);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-submodule-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	repo = makeRepo("repo", { "README.md": "# repo\n" });
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
}, 30_000);

test("a dirty submodule contributes its own files, not one opaque gitlink row", async () => {
	makeRepo("lib", { "a.txt": "base\n" });
	addSubmodule(repo, "../lib", "libs/lib");
	seedWorkspace();

	writeFileSync(join(repo, "libs/lib/a.txt"), "changed\n");
	writeFileSync(join(repo, "libs/lib/new.txt"), "new\n");

	const status = await gitStatus("w1", { kind: "uncommitted" });
	const paths = status.changes.map((change) => change.path);
	expect(paths).toContain("libs/lib/a.txt");
	expect(paths).toContain("libs/lib/new.txt");
	expect(paths).not.toContain("libs/lib");
	const edited = status.changes.find((change) => change.path === "libs/lib/a.txt");
	expect(edited).toMatchObject({ status: "modified", added: 1, removed: 1 });

	const diff = await gitDiffFile("w1", "libs/lib/a.txt", { kind: "uncommitted" });
	expect(diff.original).toBe("base\n");
	expect(diff.modified).toBe("changed\n");
	expect(diff.originalOid).toBe(gitOut(join(repo, "libs/lib"), "rev-parse", "HEAD"));

	expect(gitUncommittedPaths("w1")).toEqual(
		expect.arrayContaining(["libs/lib/a.txt", "libs/lib/new.txt"]),
	);
}, 30_000);

test("a clean submodule with an advanced pointer is one submodule row with a readable diff", async () => {
	makeRepo("lib", { "a.txt": "base\n" });
	addSubmodule(repo, "../lib", "libs/lib");
	const parent = join(repo, "libs/lib");
	const before = gitOut(parent, "rev-parse", "HEAD");
	writeFileSync(join(parent, "a.txt"), "next\n");
	git(parent, "add", "-A");
	git(parent, "commit", "-m", "next");
	const after = gitOut(parent, "rev-parse", "HEAD");
	seedWorkspace();

	const status = await gitStatus("w1", { kind: "uncommitted" });
	expect(status.changes).toEqual([{ path: "libs/lib", status: "modified", submodule: true }]);
	const diff = await gitDiffFile("w1", "libs/lib", { kind: "uncommitted" });
	expect(diff.original).toContain(`Subproject commit ${before}`);
	expect(diff.modified).toContain(`Subproject commit ${after}`);
	expect(diff.originalOid).toBeNull();
}, 30_000);

test("a pinned or commit diff inside a submodule resolves in that repository", async () => {
	makeRepo("lib", { "a.txt": "base\n" });
	addSubmodule(repo, "../lib", "libs/lib");
	const parent = join(repo, "libs/lib");
	const base = gitOut(parent, "rev-parse", "HEAD");
	writeFileSync(join(parent, "a.txt"), "next\n");
	seedWorkspace();

	const pinned = await gitDiffFile("w1", "libs/lib/a.txt", { kind: "pinned", baseRef: base });
	expect(pinned.original).toBe("base\n");
	expect(pinned.modified).toBe("next\n");
	expect(pinned.originalOid).toBe(base);

	git(parent, "commit", "-am", "next");
	const sha = gitOut(parent, "rev-parse", "HEAD");
	const committed = await gitDiffFile("w1", "libs/lib/a.txt", { kind: "commit", sha });
	expect(committed.original).toBe("base\n");
	expect(committed.modified).toBe("next\n");
}, 60_000);

test("a linked business repository outside the worktree is discovered and read", async () => {
	const business = makeRepo("business", { "code.txt": "base\n" });
	writeFileSync(join(business, "code.txt"), "changed\n");
	mkdirSync(join(repo, "Assets"));
	symlinkSync(
		business,
		join(repo, "Assets", "Game"),
		process.platform === "win32" ? "junction" : "dir",
	);
	seedWorkspace();

	const status = await gitStatus("w1", { kind: "uncommitted" });
	expect(status.changes).toContainEqual({
		path: "Assets/Game/code.txt",
		status: "modified",
		repo: "Assets/Game",
		added: 1,
		removed: 1,
	});
	const diff = await gitDiffFile("w1", "Assets/Game/code.txt", { kind: "uncommitted" });
	expect(diff.modified).toBe("changed\n");
	expect(await listNestedRepoStatuses({ id: "w1", worktreePath: repo })).toContainEqual({
		path: "Assets/Game",
		branch: "main",
		changes: 1,
	});
}, 30_000);

test("nested repo status reports its branch and divergence from the configured upstream", async () => {
	const nested = initRepoAt(join(repo, "embed"), { "e.txt": "base\n" });
	const origin = join(dataDir, "origin.git");
	mkdirSync(origin);
	git(origin, "init", "--bare");
	git(nested, "remote", "add", "origin", origin);
	git(nested, "update-ref", "refs/remotes/origin/main", "HEAD");
	git(nested, "config", "branch.main.remote", "origin");
	git(nested, "config", "branch.main.merge", "refs/heads/main");
	writeFileSync(join(nested, "e.txt"), "next\n");
	git(nested, "commit", "-am", "next");

	expect(await listNestedRepoStatuses({ id: "w1", worktreePath: repo })).toEqual([
		{ path: "embed", branch: "main", upstream: "origin/main", ahead: 1, behind: 0 },
	]);
}, 30_000);

test("an untracked embedded repository is discovered and read as a repository", async () => {
	const target = initRepoAt(join(repo, "embed"), { "e.txt": "base\n" });
	seedWorkspace();

	const clean = await gitStatus("w1", { kind: "uncommitted" });
	expect(clean.changes).toEqual([{ path: "embed", status: "untracked", submodule: true }]);
	const added = await gitDiffFile("w1", "embed", { kind: "uncommitted" });
	expect(added.original).toBe("");
	expect(added.modified).toContain("Subproject commit");

	writeFileSync(join(target, "e.txt"), "changed\n");
	const dirty = await gitStatus("w1", { kind: "uncommitted" });
	const paths = dirty.changes.map((change) => change.path);
	expect(paths).toContain("embed/e.txt");
	expect(paths).not.toContain("embed");
	expect(dirty.changes.find((change) => change.path === "embed/e.txt")).toMatchObject({
		status: "modified",
		added: 1,
		removed: 1,
	});
}, 30_000);

test("nested submodules are discovered recursively and their inner changes are reported", async () => {
	makeRepo("inner", { "n.txt": "base\n" });
	const lib = makeRepo("lib", { "a.txt": "base\n" });
	addSubmodule(lib, "../inner", "nested");
	git(lib, "-c", "protocol.file.allow=always", "submodule", "update", "--init", "--recursive");
	addSubmodule(repo, "../lib", "libs/lib");
	git(repo, "-c", "protocol.file.allow=always", "submodule", "update", "--init", "--recursive");
	seedWorkspace();

	writeFileSync(join(repo, "libs/lib/nested/n.txt"), "changed\n");

	const status = await gitStatus("w1", { kind: "uncommitted" });
	const paths = status.changes.map((change) => change.path);
	expect(paths).toContain("libs/lib/nested/n.txt");
	expect(paths).not.toContain("libs/lib/nested");
	expect(paths).not.toContain("libs/lib");

	const diff = await gitDiffFile("w1", "libs/lib/nested/n.txt", { kind: "uncommitted" });
	expect(diff.original).toBe("base\n");
	expect(diff.modified).toBe("changed\n");
	expect((await repoForPath("w1", "libs/lib/nested/n.txt")).repo.path).toBe("libs/lib/nested");
}, 30_000);

test("gitCommitPaths commits root paths and reports nested paths as skipped", async () => {
	makeRepo("lib", { "a.txt": "base\n" });
	addSubmodule(repo, "../lib", "libs/lib");
	seedWorkspace();
	writeFileSync(join(repo, "root.txt"), "root\n");
	writeFileSync(join(repo, "libs/lib/a.txt"), "inner\n");

	const committed = gitCommitPaths("w1", "root only", ["root.txt", "libs/lib/a.txt"]);
	expect(committed?.sha).toBeString();
	expect(committed?.skipped).toEqual(["libs/lib/a.txt"]);
	expect(gitOut(repo, "log", "-1", "--format=%s")).toBe("root only");
	expect(gitOut(repo, "status", "--porcelain")).toContain("libs/lib");
	expect(gitOut(join(repo, "libs/lib"), "status", "--porcelain")).toContain("a.txt");
}, 30_000);

test("a revert reads the original side from the nested repository", async () => {
	makeRepo("lib", { "a.txt": "base\n" });
	addSubmodule(repo, "../lib", "libs/lib");
	seedWorkspace();
	const target = join(repo, "libs/lib/a.txt");
	writeFileSync(target, "changed\n");

	await revertChange({
		workspaceId: "w1",
		path: "libs/lib/a.txt",
		scope: { kind: "uncommitted" },
		target: { kind: "file" },
		expect: {
			originalHash: hashBytes(new TextEncoder().encode("base\n")),
			modifiedHash: hashBytes(new TextEncoder().encode("changed\n")),
		},
	});
	expect(readFileSync(target, "utf8")).toBe("base\n");
}, 30_000);

test("a gitlink pointer cannot be reverted as a file", async () => {
	makeRepo("lib", { "a.txt": "base\n" });
	addSubmodule(repo, "../lib", "libs/lib");
	seedWorkspace();
	const parent = join(repo, "libs/lib");
	writeFileSync(join(parent, "a.txt"), "next\n");
	git(parent, "add", "-A");
	git(parent, "commit", "-m", "next");

	await expect(
		revertChange({
			workspaceId: "w1",
			path: "libs/lib",
			scope: { kind: "uncommitted" },
			target: { kind: "file" },
			expect: { originalHash: null, modifiedHash: null },
		}),
	).rejects.toThrow(/submodule pointer/);
}, 30_000);

test("a rename inside a submodule is reported by its new path", async () => {
	makeRepo("lib", { "a.txt": "base\n" });
	addSubmodule(repo, "../lib", "libs/lib");
	seedWorkspace();
	git(join(repo, "libs/lib"), "mv", "a.txt", "b.txt");

	const status = await gitStatus("w1", { kind: "uncommitted" });
	expect(status.changes.map((change) => change.path)).toEqual(["libs/lib/b.txt"]);
	expect(status.changes[0]).toMatchObject({ status: "renamed" });
}, 30_000);
