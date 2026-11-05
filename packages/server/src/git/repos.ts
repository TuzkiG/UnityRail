import { type Dirent, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { NestedRepoStatus, Workspace } from "@thinkrail/contracts";
import { loadWorkspaces } from "../persistence";
import { git, gitAsync } from "./gitExec";

const DISCOVERY_TIMEOUT_MS = 10_000;
const NESTED_STATUS_TIMEOUT_MS = 8_000;
const NESTED_STATUS_CONCURRENCY = 4;
const CACHE_MS = 30_000;
const CACHE_SWEEP_MS = 5 * 60_000;
const MAX_REPOS = 128;
const MAX_WALK_ENTRIES = 4_096;

/** A repository whose worktree lives under a workspace. `path` is workspace-relative POSIX; "" is
 * the workspace's own root repository. */
export interface WorktreeRepo {
	path: string;
	worktreePath: string;
	/** Symlink-resolved worktree root, used only for identity and containment. */
	canonical: string;
}

interface CacheEntry {
	at: number;
	root: string;
	repos: WorktreeRepo[];
}

const cache = new Map<string, CacheEntry>();
const inflightDiscovers = new Map<string, Promise<WorktreeRepo[]>>();

export function canonicalPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function contained(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function posixPath(path: string): string {
	return path.split(sep).join("/");
}

function isRepoRoot(abs: string): boolean {
	try {
		if (!statSync(abs).isDirectory()) return false;
		const dotGit = statSync(join(abs, ".git"));
		return dotGit.isDirectory() || dotGit.isFile();
	} catch {
		return false;
	}
}

/** A `.gitmodules` path whose working tree actually exists. Uninitialized submodules have no content
 * to read, so they stay invisible until Git populates them. */
function modulePaths(output: string): string[] {
	const values: string[] = [];
	for (const field of output.split("\0")) {
		if (!field) continue;
		const newline = field.indexOf("\n");
		if (newline === -1) continue;
		const value = field.slice(newline + 1);
		if (value) values.push(value);
	}
	return values;
}

function gitlinkPaths(output: string): string[] {
	const paths: string[] = [];
	for (const field of output.split("\0")) {
		if (!field.startsWith("160000 ")) continue;
		const tab = field.indexOf("\t");
		if (tab !== -1 && field.length > tab + 1) paths.push(field.slice(tab + 1));
	}
	return paths;
}

function untrackedDirs(output: string): string[] {
	return output.split("\0").filter((field) => field.endsWith("/"));
}

interface Discovery {
	repos: WorktreeRepo[];
	byCanonical: Map<string, WorktreeRepo>;
	expanded: Set<string>;
	walked: number;
	capped: boolean;
}

function createDiscovery(ws: Pick<Workspace, "worktreePath">): Discovery {
	const root = resolve(ws.worktreePath);
	const repo: WorktreeRepo = { path: "", worktreePath: root, canonical: canonicalPath(root) };
	return {
		repos: [repo],
		byCanonical: new Map([[repo.canonical, repo]]),
		expanded: new Set(),
		walked: 0,
		capped: false,
	};
}

function isLink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

function lexicallyContained(parent: string, candidate: string): boolean {
	const rel = relative(parent, candidate);
	return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function claimRepo(
	ctx: Discovery,
	abs: string,
	opts: { allowExternal?: boolean } = {},
): WorktreeRepo | null {
	const canonical = canonicalPath(abs);
	const existing = ctx.byCanonical.get(canonical);
	if (existing) return existing;
	const root = ctx.repos[0];
	if (!root) return null;
	if (!opts.allowExternal && !contained(root.canonical, canonical)) return null;
	if (ctx.repos.length >= MAX_REPOS) {
		ctx.capped = true;
		return null;
	}
	const repo: WorktreeRepo = {
		path: posixPath(relative(root.worktreePath, abs)),
		worktreePath: resolve(abs),
		canonical,
	};
	ctx.repos.push(repo);
	ctx.byCanonical.set(canonical, repo);
	return repo;
}

function skippedDir(name: string): boolean {
	return name === ".git" || name === "node_modules" || name === ".thinkrail";
}

function candidate(ctx: Discovery, parent: WorktreeRepo, path: string): WorktreeRepo | null {
	if (!path || isAbsolute(path)) return null;
	const abs = resolve(parent.worktreePath, path);
	if (!lexicallyContained(parent.worktreePath, abs)) return null;
	const root = ctx.repos[0];
	if (!root) return null;
	const canonical = canonicalPath(abs);
	/** A directory link (Windows junction or POSIX symlink) may deliberately point outside the
	 * worktree: the framework/business split uses one to mount the business repository. Git names
	 * such a path as a submodule or an untracked directory, so following it is the repository's own
	 * declaration, not a general symlink walk. A repository nested in an already-followed external
	 * repo is allowed relative to that owner. */
	const linked = !contained(root.canonical, canonical) && isLink(abs);
	const insideOwner = parent.path !== "" && contained(parent.canonical, canonical);
	if (!contained(root.canonical, canonical) && !linked && !insideOwner) return null;
	return isRepoRoot(abs) ? claimRepo(ctx, abs, { allowExternal: linked || insideOwner }) : null;
}

async function expand(ctx: Discovery, repo: WorktreeRepo): Promise<void> {
	if (ctx.expanded.has(repo.canonical)) return;
	ctx.expanded.add(repo.canonical);

	const modules = await gitAsync(
		repo.worktreePath,
		["config", "-zf", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"],
		{ raw: true, timeoutMs: DISCOVERY_TIMEOUT_MS },
	);
	if (modules.ok) {
		for (const path of modulePaths(modules.out)) {
			const found = candidate(ctx, repo, path);
			if (found && found !== repo) await expand(ctx, found);
		}
	}

	const staged = await gitAsync(repo.worktreePath, ["ls-files", "-z", "--stage"], {
		raw: true,
		timeoutMs: DISCOVERY_TIMEOUT_MS,
	});
	if (staged.ok) {
		for (const path of gitlinkPaths(staged.out)) {
			const found = candidate(ctx, repo, path);
			if (found && found !== repo) await expand(ctx, found);
		}
	}

	const untracked = await gitAsync(
		repo.worktreePath,
		["ls-files", "-z", "--others", "--exclude-standard", "--directory"],
		{ raw: true, timeoutMs: DISCOVERY_TIMEOUT_MS },
	);
	if (untracked.ok) {
		for (const entry of untrackedDirs(untracked.out)) {
			const dir = entry.slice(0, -1);
			if (!dir || isAbsolute(dir)) continue;
			if (skippedDir(dir.split("/").at(-1) ?? "")) continue;
			const abs = resolve(repo.worktreePath, dir);
			const found = candidate(ctx, repo, dir);
			if (found && found !== repo) await expand(ctx, found);
			else if (!found) await walk(ctx, abs, repo);
		}
	}
}

async function walk(ctx: Discovery, dir: string, owner: WorktreeRepo): Promise<void> {
	if (ctx.walked >= MAX_WALK_ENTRIES) {
		ctx.capped = true;
		return;
	}
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (ctx.walked >= MAX_WALK_ENTRIES) {
			ctx.capped = true;
			return;
		}
		ctx.walked++;
		if (skippedDir(entry.name)) continue;
		const link = entry.isSymbolicLink();
		if (!entry.isDirectory() && !link) continue;
		const abs = join(dir, entry.name);
		if (isRepoRoot(abs)) {
			const found = claimRepo(ctx, abs, { allowExternal: link || owner.path !== "" });
			if (found) await expand(ctx, found);
		} else if (entry.isDirectory()) await walk(ctx, abs, owner);
	}
}

async function discover(ws: Pick<Workspace, "worktreePath">): Promise<WorktreeRepo[]> {
	const ctx = createDiscovery(ws);
	const root = ctx.repos[0];
	if (!root) return [];
	await expand(ctx, root);
	return ctx.repos;
}

function expandSync(ctx: Discovery, repo: WorktreeRepo): void {
	if (ctx.expanded.has(repo.canonical)) return;
	ctx.expanded.add(repo.canonical);

	const modules = git(repo.worktreePath, [
		"config",
		"-zf",
		".gitmodules",
		"--get-regexp",
		"^submodule\\..*\\.path$",
	]);
	if (modules.ok) {
		for (const path of modulePaths(modules.out)) {
			const found = candidate(ctx, repo, path);
			if (found && found !== repo) expandSync(ctx, found);
		}
	}

	const staged = git(repo.worktreePath, ["ls-files", "-z", "--stage"]);
	if (staged.ok) {
		for (const path of gitlinkPaths(staged.out)) {
			const found = candidate(ctx, repo, path);
			if (found && found !== repo) expandSync(ctx, found);
		}
	}

	const untracked = git(repo.worktreePath, [
		"ls-files",
		"-z",
		"--others",
		"--exclude-standard",
		"--directory",
	]);
	if (untracked.ok) {
		for (const entry of untrackedDirs(untracked.out)) {
			const dir = entry.slice(0, -1);
			if (!dir || isAbsolute(dir)) continue;
			if (skippedDir(dir.split("/").at(-1) ?? "")) continue;
			const abs = resolve(repo.worktreePath, dir);
			const found = candidate(ctx, repo, dir);
			if (found && found !== repo) expandSync(ctx, found);
			else if (!found) walkSync(ctx, abs, repo);
		}
	}
}

function walkSync(ctx: Discovery, dir: string, owner: WorktreeRepo): void {
	if (ctx.walked >= MAX_WALK_ENTRIES) {
		ctx.capped = true;
		return;
	}
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (ctx.walked >= MAX_WALK_ENTRIES) {
			ctx.capped = true;
			return;
		}
		ctx.walked++;
		if (skippedDir(entry.name)) continue;
		const link = entry.isSymbolicLink();
		if (!entry.isDirectory() && !link) continue;
		const abs = join(dir, entry.name);
		if (isRepoRoot(abs)) {
			const found = claimRepo(ctx, abs, { allowExternal: link || owner.path !== "" });
			if (found) expandSync(ctx, found);
		} else if (entry.isDirectory()) walkSync(ctx, abs, owner);
	}
}

function discoverSync(ws: Pick<Workspace, "worktreePath">): WorktreeRepo[] {
	const ctx = createDiscovery(ws);
	const root = ctx.repos[0];
	if (!root) return [];
	expandSync(ctx, root);
	return ctx.repos;
}

function cached(ws: Pick<Workspace, "id" | "worktreePath">): WorktreeRepo[] | null {
	const entry = cache.get(ws.id);
	if (!entry || entry.root !== ws.worktreePath) return null;
	return Date.now() - entry.at < CACHE_MS ? entry.repos : null;
}

function store(ws: Pick<Workspace, "id" | "worktreePath">, repos: WorktreeRepo[]): void {
	const now = Date.now();
	for (const [id, entry] of cache) {
		if (now - entry.at > CACHE_SWEEP_MS) cache.delete(id);
	}
	cache.set(ws.id, { at: now, root: ws.worktreePath, repos });
}

export async function listWorktreeRepos(
	ws: Pick<Workspace, "id" | "worktreePath">,
	opts: { fresh?: boolean } = {},
): Promise<WorktreeRepo[]> {
	if (!opts.fresh) {
		const hit = cached(ws);
		if (hit) return hit;
	}
	// Concurrent cold callers share one discovery pass instead of each scanning the worktree.
	const key = `${ws.id}\0${resolve(ws.worktreePath)}`;
	const inflight = inflightDiscovers.get(key);
	if (inflight) return inflight;
	const pending = discover(ws).then((repos) => {
		store(ws, repos);
		return repos;
	});
	const tracked = pending.finally(() => {
		if (inflightDiscovers.get(key) === tracked) inflightDiscovers.delete(key);
	});
	inflightDiscovers.set(key, tracked);
	return tracked;
}

/** Discovery for a caller that holds only the worktree path (the turn tracker). The cache key is
 * path-scoped, so it never collides with a workspace id. */
export async function listWorktreeReposAt(
	worktreePath: string,
	fresh = false,
): Promise<WorktreeRepo[]> {
	return listWorktreeRepos({ id: `path:${resolve(worktreePath)}`, worktreePath }, { fresh });
}

export function listWorktreeReposSync(
	ws: Pick<Workspace, "id" | "worktreePath">,
	opts: { fresh?: boolean } = {},
): WorktreeRepo[] {
	if (!opts.fresh) {
		const hit = cached(ws);
		if (hit) return hit;
	}
	const repos = discoverSync(ws);
	store(ws, repos);
	return repos;
}

/** The repository that owns `path` (workspace-relative POSIX). A repository's own root belongs to
 * its parent, so a gitlink path is diffed against the repo that records it. */
export function ownerOf(
	repos: readonly WorktreeRepo[],
	path: string,
): { repo: WorktreeRepo; pathInRepo: string } {
	let best = repos[0];
	if (!best) throw new Error("A workspace has at least its own repository");
	for (const repo of repos) {
		if (repo.path === "" || repo.path.length <= best.path.length) continue;
		if (
			path.length > repo.path.length &&
			path.startsWith(repo.path) &&
			path[repo.path.length] === "/"
		)
			best = repo;
	}
	return {
		repo: best,
		pathInRepo: best.path === "" ? path : path.slice(best.path.length + 1),
	};
}

function branchFacts(output: string): Omit<NestedRepoStatus, "path"> | null {
	let head: string | undefined;
	let oid: string | undefined;
	let upstream: string | undefined;
	let ahead: number | undefined;
	let behind: number | undefined;
	for (const field of output.split("\0")) {
		if (field.startsWith("# branch.head ")) head = field.slice(14);
		else if (field.startsWith("# branch.oid ")) oid = field.slice(13);
		else if (field.startsWith("# branch.upstream ")) upstream = field.slice(18);
		else if (field.startsWith("# branch.ab ")) {
			const [plus, minus] = field.slice(12).split(" ");
			ahead = Number.parseInt(plus?.replace("+", "") ?? "", 10);
			behind = Number.parseInt(minus?.replace("-", "") ?? "", 10);
			if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
				ahead = undefined;
				behind = undefined;
			}
		}
	}
	if (!head) return null;
	const detached = head === "(detached)";
	return {
		branch: detached ? (oid ? oid.slice(0, 7) : "HEAD") : head,
		...(detached ? { detached: true } : {}),
		...(upstream ? { upstream } : {}),
		...(upstream && ahead !== undefined && behind !== undefined ? { ahead, behind } : {}),
	};
}

function changedFiles(output: string): number {
	let count = 0;
	for (const field of output.split("\0")) if (field && !field.startsWith("#")) count++;
	return count;
}

async function nestedRepoStatus(repo: WorktreeRepo): Promise<NestedRepoStatus | null> {
	const status = await gitAsync(
		repo.worktreePath,
		[
			"status",
			"--porcelain=v2",
			"--branch",
			"-z",
			"--untracked-files=no",
			"--ignore-submodules=all",
		],
		{ raw: true, timeoutMs: NESTED_STATUS_TIMEOUT_MS },
	);
	if (!status.ok) return null;
	const facts = branchFacts(status.out);
	const changes = changedFiles(status.out);
	return facts ? { path: repo.path, ...facts, ...(changes > 0 ? { changes } : {}) } : null;
}

async function eachLimit<T>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			for (;;) {
				const item = items[next++];
				if (item === undefined) return;
				await fn(item);
			}
		}),
	);
}

/** Local branch facts for every repository nested in the workspace, for the topbar's branch card.
 * No fetch: `ahead` / `behind` describe the remote-tracking refs Git already has. A repo whose status
 * cannot be read is skipped rather than failing the whole read. */
export async function listNestedRepoStatuses(
	ws: Pick<Workspace, "id" | "worktreePath">,
): Promise<NestedRepoStatus[]> {
	const repos = (await listWorktreeRepos(ws)).filter((repo) => repo.path !== "");
	const infos: NestedRepoStatus[] = [];
	await eachLimit(repos, NESTED_STATUS_CONCURRENCY, async (repo) => {
		const info = await nestedRepoStatus(repo);
		if (info) infos.push(info);
	});
	return infos.sort((a, b) => a.path.localeCompare(b.path));
}

function workspace(workspaceId: string): Workspace {
	const ws = loadWorkspaces().find((candidate) => candidate.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);
	return ws;
}

export async function repoForPath(
	workspaceId: string,
	path: string,
): Promise<{ repo: WorktreeRepo; pathInRepo: string }> {
	const ws = workspace(workspaceId);
	return ownerOf(await listWorktreeRepos(ws), path);
}

export function repoForPathSync(
	workspaceId: string,
	path: string,
): { repo: WorktreeRepo; pathInRepo: string } {
	const ws = workspace(workspaceId);
	return ownerOf(listWorktreeReposSync(ws), path);
}

export function forgetWorktreeRepos(workspaceId: string): void {
	cache.delete(workspaceId);
}
