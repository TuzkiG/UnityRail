import type { GitFileChange } from "@thinkrail/contracts";
import { gitCommitFilesBulk, gitStatus } from "../git/git";
import { getWorkspace } from "../workspaces";

export const COMMIT_FILES_CACHE_MAX = 500;

const SEP = "\u0000";

function cacheKey(workspaceId: string, sha: string): string {
	return `${workspaceId}${SEP}${sha}`;
}

/** A commit's rows are immutable per (workspace, full sha) — two clones can share a sha while only
 * one still has the object, so the key carries the workspace. Only a deleted workspace can stale an
 * entry, so a miss drops the rows of workspaces `forgetDead` no longer finds. */
export class CommitFilesCache {
	private readonly entries = new Map<string, GitFileChange[]>();
	private readonly limit: number;

	constructor(limit = COMMIT_FILES_CACHE_MAX) {
		this.limit = limit;
	}

	get size(): number {
		return this.entries.size;
	}

	/** Reading is a write here: lifting the entry to the MRU end is what makes eviction least-recent. */
	read(workspaceId: string, sha: string): GitFileChange[] | undefined {
		const key = cacheKey(workspaceId, sha);
		const hit = this.entries.get(key);
		if (!hit) return undefined;
		this.entries.delete(key);
		this.entries.set(key, hit);
		return hit;
	}

	write(workspaceId: string, sha: string, files: GitFileChange[]): void {
		const key = cacheKey(workspaceId, sha);
		this.entries.delete(key);
		this.entries.set(key, files);
		while (this.entries.size > this.limit) {
			const oldest = this.entries.keys().next();
			if (oldest.done) break;
			this.entries.delete(oldest.value);
		}
	}

	forgetDead(alive: (workspaceId: string) => boolean): void {
		const owners = new Set<string>();
		for (const key of this.entries.keys()) owners.add(key.slice(0, key.indexOf(SEP)));
		for (const workspaceId of owners) {
			if (alive(workspaceId)) continue;
			for (const key of this.entries.keys()) {
				if (key.startsWith(`${workspaceId}${SEP}`)) this.entries.delete(key);
			}
		}
	}
}

const commitFiles = new CommitFilesCache();

function workspaceAlive(workspaceId: string): boolean {
	try {
		getWorkspace(workspaceId);
		return true;
	} catch {
		return false;
	}
}

/** The bulk path needs a full object name; an abbreviated artifact sha keeps the per-commit fallback. */
function batchable(sha: string): boolean {
	return /^[0-9a-f]{40,64}$/.test(sha);
}

/** Fills the cache for every artifact of a plan in one `git log`; a failed batch leaves the misses to
 * `resolveCommitFiles`, so decoration degrades to the per-commit read rather than dropping rows. */
export async function prefetchCommitFiles(
	workspaceId: string,
	shas: readonly string[],
): Promise<void> {
	const wanted = [...new Set(shas)].filter(
		(sha) => batchable(sha) && !commitFiles.read(workspaceId, sha),
	);
	if (wanted.length === 0) return;
	commitFiles.forgetDead(workspaceAlive);
	let bulk: Map<string, GitFileChange[]>;
	try {
		bulk = await gitCommitFilesBulk(workspaceId, wanted);
	} catch {
		return;
	}
	for (const [sha, files] of bulk) commitFiles.write(workspaceId, sha, files);
}

export async function resolveCommitFiles(
	workspaceId: string,
	sha: string,
): Promise<GitFileChange[] | undefined> {
	const hit = commitFiles.read(workspaceId, sha);
	if (hit) return hit;
	commitFiles.forgetDead(workspaceAlive);
	try {
		const files = (await gitStatus(workspaceId, { kind: "commit", sha })).changes;
		commitFiles.write(workspaceId, sha, files);
		return files;
	} catch {
		return undefined;
	}
}
