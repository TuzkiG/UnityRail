import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { gitAsync, nonInteractiveGitEnv } from "./gitExec";
import { listWorktreeReposAt } from "./repos";

const SNAPSHOT_TIMEOUT_MS = 20_000;
const NESTED_SNAPSHOT_CONCURRENCY = 4;

export interface NestedSnapshot {
	repo: string;
	tree: string;
}

export async function snapshotWorktree(worktreePath: string): Promise<string | null> {
	const indexOut = await gitAsync(worktreePath, ["rev-parse", "--git-path", "index"], {
		timeoutMs: SNAPSHOT_TIMEOUT_MS,
	});
	if (!indexOut.ok || !indexOut.out) return null;
	const indexPath = isAbsolute(indexOut.out) ? indexOut.out : resolve(worktreePath, indexOut.out);
	const scratch = mkdtempSync(join(tmpdir(), "thinkrail-snapshot-"));
	const scratchIndex = join(scratch, "index");
	try {
		try {
			copyFileSync(indexPath, scratchIndex);
		} catch {}
		const env = { ...nonInteractiveGitEnv(), GIT_INDEX_FILE: scratchIndex };
		const added = await gitAsync(worktreePath, ["add", "-A", "--ignore-errors", "--", "."], {
			env,
			timeoutMs: SNAPSHOT_TIMEOUT_MS,
		});
		if (!added.ok && (added.failure || /^fatal:/m.test(added.err))) return null;
		const tree = await gitAsync(worktreePath, ["write-tree"], {
			env,
			timeoutMs: SNAPSHOT_TIMEOUT_MS,
		});
		return tree.ok && tree.out ? tree.out : null;
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

/** One tree per nested repository under the worktree. A repository whose snapshot fails is omitted
 * rather than voiding the others; the root is snapshotted by `snapshotWorktree` itself. */
export async function snapshotNestedWorktrees(worktreePath: string): Promise<NestedSnapshot[]> {
	const repos = (await listWorktreeReposAt(worktreePath, true)).filter((repo) => repo.path !== "");
	const snapshots: NestedSnapshot[] = [];
	let next = 0;
	const workers = Array.from(
		{ length: Math.min(NESTED_SNAPSHOT_CONCURRENCY, repos.length) },
		async () => {
			for (;;) {
				const index = next++;
				const repo = repos[index];
				if (!repo) return;
				const tree = await snapshotWorktree(repo.worktreePath);
				if (tree) snapshots.push({ repo: repo.path, tree });
			}
		},
	);
	await Promise.all(workers);
	snapshots.sort((a, b) => a.repo.localeCompare(b.repo));
	return snapshots;
}
