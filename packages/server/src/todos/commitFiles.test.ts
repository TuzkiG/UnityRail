import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitFileChange } from "@thinkrail/contracts";
import { TodoStore } from "pi-todos/core";
import { gitStatus } from "../git";
import { gitCommitFilesBulk } from "../git/git";
import { CommitFilesCache } from "./commitFiles";
import { listTodos } from "./todos";

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const SESSION = "sess-commit-files";

function sh(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

function headSha(): string {
	const result = Bun.spawnSync(["git", "-C", repo, "rev-parse", "HEAD"]);
	return result.stdout.toString().trim();
}

const rows = (path: string): GitFileChange[] => [{ path, status: "added", added: 1 }];

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-todos-commit-files-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	sh(repo, "init", "-b", "main");
	sh(repo, "config", "user.email", "t@thinkrail.test");
	sh(repo, "config", "user.name", "test");
	sh(repo, "config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	sh(repo, "add", "-A");
	sh(repo, "commit", "-m", "init");
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
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("gitCommitFilesBulk reads every commit shape the per-commit scope reads, in one log", async () => {
	const initial = headSha();
	writeFileSync(join(repo, "gone.ts"), "export {};\n");
	const movedBody = Array.from({ length: 20 }, (_, i) => `export const v${i} = ${i};`).join("\n");
	writeFileSync(join(repo, "moved.ts"), `${movedBody}\n`);
	sh(repo, "add", "-A");
	sh(repo, "commit", "-m", "seed");
	writeFileSync(join(repo, "added.ts"), "export const added = 1;\nexport const two = 2;\n");
	writeFileSync(join(repo, "README.md"), "# repo\nmore\n");
	sh(repo, "rm", "-q", "gone.ts");
	sh(repo, "add", "-A");
	sh(repo, "commit", "-m", "add/change/delete");
	const mixed = headSha();
	sh(repo, "mv", "moved.ts", "renamed.ts");
	writeFileSync(join(repo, "renamed.ts"), `${movedBody}\nexport const extra = 1;\n`);
	sh(repo, "add", "-A");
	sh(repo, "commit", "-m", "rename");
	const renamed = headSha();
	sh(repo, "checkout", "-q", "-b", "side");
	writeFileSync(join(repo, "side.ts"), "export {};\n");
	sh(repo, "add", "-A");
	sh(repo, "commit", "-m", "side work");
	sh(repo, "checkout", "-q", "main");
	writeFileSync(join(repo, "main.ts"), "export {};\n");
	sh(repo, "add", "-A");
	sh(repo, "commit", "-m", "main work");
	sh(repo, "merge", "-q", "--no-ff", "side", "-m", "merge side");
	const merged = headSha();
	sh(repo, "commit", "-q", "--allow-empty", "-m", "empty");
	const empty = headSha();

	const shas = [mixed, renamed, merged, empty, initial];
	const bulk = await gitCommitFilesBulk("w1", shas);
	expect([...bulk.keys()].sort()).toEqual([...shas].sort());
	for (const sha of shas) {
		expect(bulk.get(sha)).toEqual((await gitStatus("w1", { kind: "commit", sha })).changes);
	}
	expect(bulk.get(mixed)).toMatchObject([
		{ path: "added.ts", status: "added", added: 2 },
		{ path: "gone.ts", status: "deleted", removed: 1 },
		{ path: "README.md", status: "modified", added: 1 },
	]);
	expect(bulk.get(renamed)?.map((file) => [file.path, file.status])).toEqual([
		["renamed.ts", "renamed"],
	]);
	expect(bulk.get(merged)?.map((file) => [file.path, file.status])).toEqual([["side.ts", "added"]]);
	expect(bulk.get(empty)).toEqual([]);
	expect(bulk.get(initial)).toEqual(
		(await gitStatus("w1", { kind: "commit", sha: initial })).changes,
	);
}, 30_000);

test("gitCommitFilesBulk skips a sha it cannot resolve or batch, and never throws for one", async () => {
	const sha = headSha();
	const missing = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
	const bulk = await gitCommitFilesBulk("w1", [missing, sha.slice(0, 8), "not-a-sha", sha, sha]);
	expect([...bulk.keys()]).toEqual([sha]);
	expect(await gitCommitFilesBulk("w1", ["not-a-sha"])).toEqual(new Map());
	expect(gitCommitFilesBulk("no-such-workspace", [missing])).rejects.toThrow("Unknown workspace");
});

test("the commit-files LRU evicts the least-recently-read entry and drops dead workspaces", () => {
	const cache = new CommitFilesCache(2);
	cache.write("w1", "a", rows("a"));
	cache.write("w1", "b", rows("b"));
	expect(cache.read("w1", "b")?.map((file) => file.path)).toEqual(["b"]);
	cache.write("w1", "c", rows("c"));
	expect(cache.size).toBe(2);
	expect(cache.read("w1", "a")).toBeUndefined();
	expect(cache.read("w1", "b")?.[0]?.path).toBe("b");
	cache.write("w2", "a", rows("w2-a"));
	expect(cache.read("w1", "b")?.[0]?.path).toBe("b");
	expect(cache.read("w2", "a")?.[0]?.path).toBe("w2-a");
	expect(cache.read("w1", "c")).toBeUndefined();
	cache.forgetDead((workspaceId) => workspaceId === "w2");
	expect(cache.size).toBe(1);
	expect(cache.read("w1", "b")).toBeUndefined();
	expect(cache.read("w2", "a")?.[0]?.path).toBe("w2-a");
});

test("listTodos decorates grouped and loose commit artifacts, and the rows survive a re-read", async () => {
	const store = new TodoStore(repo, SESSION);
	writeFileSync(join(repo, "one.ts"), "export {};\n");
	sh(repo, "add", "-A");
	sh(repo, "commit", "-m", "one");
	const one = headSha();
	writeFileSync(join(repo, "two.ts"), "export {};\n");
	sh(repo, "add", "-A");
	sh(repo, "commit", "-m", "two");
	const two = headSha();
	store.add({
		title: "grouped step",
		group: "Phase 1",
		artifacts: [
			{ kind: "commit", sha: one, label: "one" },
			{ kind: "commit", sha: two, label: "two" },
		],
	});
	store.add({ title: "loose step", artifacts: [{ kind: "commit", sha: rootSha() }] });

	const paths = (plan: Awaited<ReturnType<typeof listTodos>>, id: string) =>
		plan.todos
			.concat(plan.groups.flatMap((group) => group.todos))
			.find((todo) => todo.id === id)
			?.artifacts?.flatMap((artifact) => artifact.files?.map((file) => file.path) ?? []);

	const first = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	const grouped = first.groups.flatMap((group) => group.todos)[0];
	expect(paths(first, grouped?.id ?? "")).toEqual(["one.ts", "two.ts"]);
	expect(paths(first, first.todos[0]?.id ?? "")).toEqual(["README.md"]);
	const second = await listTodos({ workspaceId: "w1", sessionId: SESSION });
	expect(paths(second, grouped?.id ?? "")).toEqual(["one.ts", "two.ts"]);
	expect(paths(second, second.todos[0]?.id ?? "")).toEqual(["README.md"]);
}, 30_000);

function rootSha(): string {
	const result = Bun.spawnSync(["git", "-C", repo, "rev-list", "--max-parents=0", "HEAD"]);
	return result.stdout.toString().trim();
}
