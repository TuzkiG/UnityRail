import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type {
	BranchList,
	GitCommit,
	GitDiffScope,
	GitFileChange,
	GitFileStatus,
	GitStatus,
	RemoteBranchGroup,
	ResourceMeta,
	Workspace,
} from "@thinkrail/contracts";
import {
	CONTENT_SNIFF_BYTES,
	classifyBytes,
	decodeText,
	resolveWorktreeFile,
	resourceMeta,
} from "../fs";
import { logger } from "../log";
import { loadProjects, loadWorkspaces } from "../persistence";
import {
	changedFileArgs,
	type DiffRange,
	diffBaseRef,
	resolveCommitOid,
	resolveDiffRange,
	resolveUncommittedRange,
} from "./diffScope";
import {
	type GitResult,
	type GitSyncOptions,
	git,
	gitAsync,
	gitAsyncBytes,
	gitAsyncStream,
	gitBytes,
	INDEX_WRITE_TIMEOUT_MS,
	nonInteractiveGitEnv,
	SLOW_GIT_TIMEOUT_MS,
	throwOnTimeout,
} from "./gitExec";
import { isSafeRef, remoteNameOf } from "./refs";
import {
	canonicalPath,
	forgetWorktreeRepos,
	listWorktreeRepos,
	listWorktreeReposSync,
	ownerOf,
	type WorktreeRepo,
} from "./repos";

export { canonicalPath };

const log = logger("git");

function workspace(workspaceId: string): Workspace {
	const ws = loadWorkspaces().find((w) => w.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);
	return ws;
}

const COMMIT_PATHS = "commit the TODO's changes";

export function gitCommitPaths(
	workspaceId: string,
	message: string,
	paths: string[],
): { sha: string | null; skipped: string[] } | null {
	if (paths.length === 0) return null;
	const ws = workspace(workspaceId);
	const repos = listWorktreeReposSync(ws, { fresh: true });
	const rootPaths: string[] = [];
	const skipped: string[] = [];
	for (const path of paths) {
		if (ownerOf(repos, path).repo.path === "") rootPaths.push(path);
		else skipped.push(path);
	}
	if (rootPaths.length === 0) return { sha: null, skipped };
	const sha = commitPathsInRepo(ws.worktreePath, message, rootPaths);
	return sha === null ? null : { sha, skipped };
}

function commitPathsInRepo(cwd: string, message: string, paths: string[]): string | null {
	const unmerged = git(cwd, ["ls-files", "-u"]);
	if (!unmerged.ok || unmerged.out) return null;
	const indexOut = git(cwd, ["rev-parse", "--git-path", "index"]);
	if (!indexOut.ok || !indexOut.out) return null;
	const before = headShaAt(cwd);
	const indexPath = isAbsolute(indexOut.out) ? indexOut.out : resolve(cwd, indexOut.out);
	let saved: Buffer | null = null;
	try {
		saved = readFileSync(indexPath);
	} catch {
		saved = null;
	}
	const restoreIndex = (result: GitResult): null => {
		try {
			if (saved === null) rmSync(indexPath, { force: true });
			else writeFileSync(indexPath, saved);
		} catch {}
		throwOnTimeout(result, COMMIT_PATHS);
		return null;
	};
	const writer = { timeoutMs: INDEX_WRITE_TIMEOUT_MS, action: COMMIT_PATHS };
	const staging = { ...writer, onTimeout: "return" as const };
	const added = git(cwd, ["--literal-pathspecs", "add", "-A", "--", ...paths], staging);
	if (!added.ok) return restoreIndex(added);
	const staged = git(
		cwd,
		["--literal-pathspecs", "diff", "--cached", "--quiet", "--", ...paths],
		staging,
	);
	if (staged.ok || staged.failure === "timeout") return restoreIndex(staged);
	const committed = git(
		cwd,
		["--literal-pathspecs", "commit", "--no-verify", "-m", message, "--", ...paths],
		staging,
	);
	const sha = headShaAt(cwd, writer);
	if (committed.ok) return sha;
	if (sha === before) return restoreIndex(committed);
	return sha && isOurCommit(cwd, { sha, before, message, paths }, writer) ? sha : null;
}

function isOurCommit(
	cwd: string,
	commit: { sha: string; before: string | null; message: string; paths: string[] },
	opts: GitSyncOptions,
) {
	if (parentOf(cwd, commit.sha, opts) !== commit.before) return false;
	const body = git(cwd, ["log", "-1", "--format=%B", "--end-of-options", commit.sha, "--"], opts);
	if (!body.ok || body.out !== commit.message.trim()) return false;
	const touched = git(
		cwd,
		[
			"--literal-pathspecs",
			"diff-tree",
			"--quiet",
			"-r",
			"--root",
			"--end-of-options",
			commit.sha,
			"--",
			...commit.paths,
		],
		opts,
	);
	return !touched.ok && !touched.err;
}

function parentOf(cwd: string, sha: string, opts: GitSyncOptions) {
	const parent = git(
		cwd,
		["rev-parse", "--verify", "--quiet", "--end-of-options", `${sha}^`],
		opts,
	);
	return parent.ok && parent.out ? parent.out : null;
}

export function gitHeadSha(workspaceId: string): string | null {
	return headShaAt(workspace(workspaceId).worktreePath);
}

export function headShaAt(repoPath: string, opts: GitSyncOptions = {}): string | null {
	const head = git(repoPath, ["rev-parse", "--verify", "--quiet", "HEAD"], {
		action: "read HEAD",
		...opts,
	});
	return head.ok && head.out ? head.out : null;
}

export function readCommitSubject(workspaceId: string, sha: string): string | null {
	if (!/^[0-9a-f]{4,64}$/.test(sha)) return null;
	const cwd = workspace(workspaceId).worktreePath;
	const out = git(cwd, ["log", "-1", "--format=%s", "--end-of-options", `${sha}^{commit}`, "--"], {
		action: "read the commit subject",
	});
	return out.ok ? plainText(out.out) : null;
}

// MUST stay in lock-step with listCommits' capped base..HEAD set (same COMMIT_LIST_MAX + range). see submodule-server-todos
export function resolveListedCommit(workspaceId: string, sha: string): string | null {
	if (!/^[0-9a-f]{4,64}$/.test(sha)) return null;
	const ws = workspace(workspaceId);
	const cwd = ws.worktreePath;
	const canonical = resolveCommitOid(cwd, sha);
	if (!canonical) return null;
	const listed = git(
		cwd,
		[
			"rev-list",
			`--max-count=${COMMIT_LIST_MAX}`,
			"--end-of-options",
			`${diffBaseRef(ws)}..HEAD`,
			"--",
		],
		{ action: "list the branch commits" },
	);
	if (!listed.ok) return null;
	return listed.out.split("\n").includes(canonical) ? canonical : null;
}

function lines(out: string): string[] {
	return out
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
}

const LOCAL_REF_PREFIX = "refs/heads/";
const REMOTE_REF_PREFIX = "refs/remotes/";

function refWithin(ref: string, prefix: string): string | null {
	if (!ref.startsWith(prefix)) return null;
	const name = ref.slice(prefix.length);
	return name || null;
}

function groupRemoteRefs(refs: string[], remotes: string[]): RemoteBranchGroup[] {
	const groups = new Map<string | null, RemoteBranchGroup>();
	for (const ref of refs) {
		const remote = remoteNameOf(ref, remotes);
		const branch = remote ? ref.slice(`${remote}/`.length) : ref;
		const group = groups.get(remote);
		if (group) group.branches.push({ ref, branch });
		else groups.set(remote, { remote, branches: [{ ref, branch }] });
	}
	return [...groups.values()];
}

export async function listBranches(projectId: string): Promise<BranchList> {
	const project = loadProjects().find((p) => p.id === projectId);
	if (!project) throw new Error(`Unknown project: ${projectId}`);
	return listBranchesAt(project.path);
}

const BRANCH_LIST_TTL_MS = 5_000;
const DEFAULT_BRANCH_TTL_MS = 30_000;
const GIT_DIR_TTL_MS = 60_000;

const gitDirByRepo = new Map<string, { dir: string; at: number }>();
const branchListCache = new Map<string, { fingerprint: string; value: BranchList; at: number }>();
const branchListFlights = new Map<string, { fingerprint: string; promise: Promise<BranchList> }>();
const defaultBranchCache = new Map<string, { fingerprint: string; value: string; at: number }>();

function gitDirFor(repo: string): string | null {
	const cached = gitDirByRepo.get(repo);
	if (cached && Date.now() - cached.at < GIT_DIR_TTL_MS) return cached.dir;
	const out = git(repo, ["rev-parse", "--absolute-git-dir"], {
		action: "resolve the git directory",
	});
	if (!out.ok || !out.out) return null;
	const dir = out.out;
	gitDirByRepo.set(repo, { dir, at: Date.now() });
	return dir;
}

/** HEAD, the checked-out ref and the ref directories' mtimes: a branch add, delete, move or
 * checkout invalidates it. */
function refsFingerprint(repo: string, head: string | null): string | null {
	const dir = gitDirFor(repo);
	if (!dir) return null;
	const parts = [head ?? ""];
	for (const rel of ["HEAD", "refs", "refs/heads", "refs/remotes", "packed-refs"]) {
		const stat = statSync(join(dir, rel), { bigint: true, throwIfNoEntry: false });
		parts.push(stat ? `${stat.mtimeNs}:${stat.size}` : "-");
	}
	return parts.join("|");
}

export async function listBranchesAt(repo: string): Promise<BranchList> {
	const head = headShaAt(repo, { onTimeout: "return" });
	const fingerprint = refsFingerprint(repo, head);
	const cached = fingerprint ? branchListCache.get(repo) : undefined;
	if (cached && cached.fingerprint === fingerprint && Date.now() - cached.at < BRANCH_LIST_TTL_MS)
		return cached.value;
	const flight = fingerprint ? branchListFlights.get(repo) : undefined;
	if (flight && flight.fingerprint === fingerprint) return flight.promise;
	const promise = readBranchList(repo, head)
		.then((value) => {
			if (fingerprint) branchListCache.set(repo, { fingerprint, value, at: Date.now() });
			return value;
		})
		.finally(() => {
			if (branchListFlights.get(repo)?.promise === promise) branchListFlights.delete(repo);
		});
	if (fingerprint) branchListFlights.set(repo, { fingerprint, promise });
	return promise;
}

async function readBranchList(repo: string, head: string | null): Promise<BranchList> {
	const [localRefs, remoteRefs, remoteNames] = await Promise.all([
		gitAsync(repo, ["for-each-ref", "--format=%(refname)", "refs/heads"]),
		gitAsync(repo, ["for-each-ref", "--format=%(refname)\t%(symref)", "refs/remotes"]),
		gitAsync(repo, ["remote"]),
	]);
	if (!localRefs.ok)
		throw new Error(`Could not list local branches: ${localRefs.err || "git failed"}`);
	if (!remoteRefs.ok)
		throw new Error(`Could not list remote branches: ${remoteRefs.err || "git failed"}`);
	if (!remoteNames.ok)
		throw new Error(`Could not list remotes: ${remoteNames.err || "git failed"}`);
	const local = lines(localRefs.out)
		.map((ref) => refWithin(ref, LOCAL_REF_PREFIX) ?? "")
		.filter(Boolean);
	const remote = lines(remoteRefs.out)
		.map((line) => line.split("\t"))
		.filter((parts) => !parts[1])
		.map((parts) => refWithin(parts[0] ?? "", REMOTE_REF_PREFIX) ?? "")
		.filter(Boolean);

	const upstream = git(repo, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
	return {
		local,
		remote,
		remoteGroups: groupRemoteRefs(remote, lines(remoteNames.out)),
		defaultBranch: resolveDefaultBranch(repo, head),
		...(upstream.ok && upstream.out ? { upstream: upstream.out } : {}),
	};
}

export function listRemotes(repoPath: string): string[] {
	return lines(git(repoPath, ["remote"], { action: "list the remotes" }).out);
}

export function resolveDefaultBranch(
	repoPath: string,
	head: string | null = headShaAt(repoPath, { onTimeout: "return" }),
): string {
	const fingerprint = refsFingerprint(repoPath, head);
	const cached = fingerprint ? defaultBranchCache.get(repoPath) : undefined;
	if (
		cached &&
		cached.fingerprint === fingerprint &&
		Date.now() - cached.at < DEFAULT_BRANCH_TTL_MS
	)
		return cached.value;
	const value = readDefaultBranch(repoPath);
	if (fingerprint) defaultBranchCache.set(repoPath, { fingerprint, value, at: Date.now() });
	return value;
}

function readDefaultBranch(repoPath: string): string {
	const originHeadRef = `${REMOTE_REF_PREFIX}origin/HEAD`;
	const action = "resolve the default branch";
	const originHead = git(repoPath, ["symbolic-ref", originHeadRef], { action });
	const originDefault = originHead.ok ? refWithin(originHead.out, REMOTE_REF_PREFIX) : null;
	if (originDefault) return originDefault;
	const rows = lines(
		git(repoPath, ["for-each-ref", "--format=%(refname)\t%(symref)", "refs/remotes"], { action })
			.out,
	).map((line) => line.split("\t"));
	const otherHead = rows.find(
		([ref, symref]) =>
			ref !== originHeadRef &&
			ref?.startsWith(REMOTE_REF_PREFIX) &&
			ref.endsWith("/HEAD") &&
			symref?.startsWith(REMOTE_REF_PREFIX),
	)?.[1];
	const otherDefault = refWithin(otherHead ?? "", REMOTE_REF_PREFIX);
	if (otherDefault) return otherDefault;
	if (rows.some(([ref, symref]) => ref === `${REMOTE_REF_PREFIX}origin/main` && !symref))
		return "origin/main";
	return currentBranch(repoPath);
}

const HEAD_BRANCH_ARGS = ["symbolic-ref", "--short", "HEAD"];
const TOP_LEVEL_ARGS = ["rev-parse", "--show-toplevel"];
const READ_BRANCH = "read the current branch";

function detachedAtTopLevel(repoPath: string, topLevel: GitResult): "HEAD" | null {
	return topLevel.ok && canonicalPath(topLevel.out) === canonicalPath(repoPath) ? "HEAD" : null;
}

export function tryCurrentBranch(repoPath: string): string | null {
	const head = git(repoPath, HEAD_BRANCH_ARGS, { action: READ_BRANCH });
	if (head.ok && head.out) return head.out;
	return detachedAtTopLevel(repoPath, git(repoPath, TOP_LEVEL_ARGS, { action: READ_BRANCH }));
}

export function currentBranch(repoPath: string): string {
	return tryCurrentBranch(repoPath) ?? "HEAD";
}

async function currentBranchAsync(repoPath: string): Promise<string> {
	const head = throwOnTimeout(await gitAsync(repoPath, HEAD_BRANCH_ARGS), READ_BRANCH);
	if (head.ok && head.out) return head.out;
	const topLevel = throwOnTimeout(await gitAsync(repoPath, TOP_LEVEL_ARGS), READ_BRANCH);
	return detachedAtTopLevel(repoPath, topLevel) ?? "HEAD";
}

function remoteRefArgs(ref: string): string[] {
	return ["rev-parse", "--verify", "--quiet", "--end-of-options", `${REMOTE_REF_PREFIX}${ref}`];
}

const RESOLVE_REMOTE_BRANCH = "resolve a remote branch";

function remoteOidFrom(result: GitResult): string | null {
	throwOnTimeout(result, RESOLVE_REMOTE_BRANCH);
	return result.ok && result.out !== "" ? result.out : null;
}

export function remoteRefOid(repoPath: string, ref: string): string | null {
	if (!isSafeRef(ref)) return null;
	return remoteOidFrom(git(repoPath, remoteRefArgs(ref), { action: RESOLVE_REMOTE_BRANCH }));
}

export async function remoteRefOidAsync(repoPath: string, ref: string): Promise<string | null> {
	if (!isSafeRef(ref)) return null;
	return remoteOidFrom(await gitAsync(repoPath, remoteRefArgs(ref)));
}

export async function prefetchBranch(
	projectId: string,
	ref: string,
): Promise<{ ok: boolean; moved: boolean }> {
	const project = loadProjects().find((p) => p.id === projectId);
	if (!project || !isSafeRef(ref)) return { ok: false, moved: false };
	const remoteName = remoteNameOf(ref, listRemotes(project.path));
	if (!remoteName) return { ok: false, moved: false };
	const before = await remoteRefOidAsync(project.path, ref);
	const result = await gitAsync(
		project.path,
		["fetch", remoteName, "--", ref.slice(`${remoteName}/`.length)],
		{ network: true },
	);
	const after = await remoteRefOidAsync(project.path, ref);
	const moved = after !== null && after !== before;
	return { ok: result.ok, moved };
}

function parseNumstat(output: string): Map<string, { added: number; removed: number }> {
	const counts = new Map<string, { added: number; removed: number }>();
	const fields = nulFields(output);
	for (let index = 0; index < fields.length; ) {
		const header = fields[index++] ?? "";
		const firstTab = header.indexOf("\t");
		const secondTab = firstTab < 0 ? -1 : header.indexOf("\t", firstTab + 1);
		if (firstTab < 0 || secondTab < 0) continue;
		const added = Number(header.slice(0, firstTab));
		const removed = Number(header.slice(firstTab + 1, secondTab));
		let path = header.slice(secondTab + 1);
		if (!path) {
			index++;
			path = fields[index++] ?? "";
		}
		if (!path || !Number.isFinite(added) || !Number.isFinite(removed)) continue;
		counts.set(path, { added, removed });
	}
	return counts;
}

async function numstat(
	worktreePath: string,
	range: DiffRange,
): Promise<Map<string, { added: number; removed: number }>> {
	const out = await gitAsync(worktreePath, changedFileArgs(range, "--numstat", true), {
		raw: true,
	});
	if (!out.ok) throw diffFailure(out.err);
	return parseNumstat(out.out);
}

function lineCount(content: string): number {
	if (content.length === 0) return 0;
	return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

const UNTRACKED_COUNT_MAX_BYTES = 2 * 1024 * 1024;
const UNTRACKED_COUNT_TOTAL_BYTES = 32 * 1024 * 1024;

/** The count for one untracked file in a nested repository: none when it is large or not decodable text. */
function untrackedAdded(worktreePath: string, path: string): number | undefined {
	try {
		const abs = resolve(worktreePath, path);
		if (statSync(abs).size > UNTRACKED_COUNT_MAX_BYTES) return undefined;
		const bytes = readFileSync(abs);
		if (!classifyBytes(bytes).text) return undefined;
		return lineCount(decodeText(bytes));
	} catch {
		return undefined;
	}
}

async function untrackedLineCounts(
	worktreePath: string,
	paths: readonly string[],
): Promise<Map<string, number>> {
	const counts = new Map<string, number>();
	let budget = UNTRACKED_COUNT_TOTAL_BYTES;
	for (const path of paths) {
		try {
			const abs = resolve(worktreePath, path);
			const { size } = await stat(abs);
			if (size > UNTRACKED_COUNT_MAX_BYTES || size > budget) continue;
			budget -= size;
			const bytes = await readFile(abs);
			if (classifyBytes(bytes).text) counts.set(path, lineCount(decodeText(bytes)));
		} catch {}
	}
	return counts;
}

function diffFailure(stderr: string): Error {
	return new Error(`Could not read the changed files: ${stderr || "git failed"}`);
}

function nulFields(output: string): string[] {
	const fields = output.split("\0");
	if (fields.at(-1) === "") fields.pop();
	return fields;
}

interface RawChange {
	code: string;
	path: string;
	gitlink: boolean;
}

function parseRaw(output: string): RawChange[] {
	const fields = nulFields(output);
	const parsed: RawChange[] = [];
	for (let index = 0; index < fields.length; ) {
		const header = fields[index++] ?? "";
		if (!header.startsWith(":")) continue;
		const parts = header.slice(1).split(" ");
		const [srcMode, dstMode, , , code] = parts;
		let path = fields[index++] ?? "";
		if ((code ?? "").startsWith("R") || (code ?? "").startsWith("C")) path = fields[index++] ?? "";
		if (path)
			parsed.push({
				code: code ?? "",
				path,
				gitlink: srcMode === "160000" || dstMode === "160000",
			});
	}
	return parsed;
}

interface PorcelainChange {
	path: string;
	status: GitFileStatus;
	submodule: boolean;
}

function parsePorcelainV2(output: string): PorcelainChange[] {
	const fields = nulFields(output);
	const parsed: PorcelainChange[] = [];
	for (let index = 0; index < fields.length; ) {
		const field = fields[index++] ?? "";
		if (field.startsWith("? ")) {
			parsed.push({ path: field.slice(2), status: "untracked", submodule: false });
			continue;
		}
		if (field.startsWith("! ")) continue;
		const parts = field.split(" ");
		const kind = parts[0];
		if (kind === "1" && parts.length >= 9) {
			parsed.push({
				path: parts.slice(8).join(" "),
				status: mapStatus(parts[1] ?? ""),
				submodule: parts[5] === "160000" || (parts[2] ?? "").startsWith("S"),
			});
			continue;
		}
		if (kind === "2" && parts.length >= 10) {
			parsed.push({
				path: parts.slice(9).join(" "),
				status: mapStatus(parts[1] ?? ""),
				submodule: parts[5] === "160000" || (parts[2] ?? "").startsWith("S"),
			});
			index++;
			continue;
		}
		if (kind === "u" && parts.length >= 11) {
			parsed.push({
				path: parts.slice(10).join(" "),
				status: "modified",
				submodule: parts[6] === "160000",
			});
		}
	}
	return parsed;
}

function mapStatus(code: string): GitFileStatus {
	if (code.startsWith("A") || code.startsWith("C")) return "added";
	if (code.startsWith("D")) return "deleted";
	if (code.startsWith("R")) return "renamed";
	return "modified";
}

function rootRepo(ws: Workspace): WorktreeRepo {
	return { path: "", worktreePath: ws.worktreePath, canonical: canonicalPath(ws.worktreePath) };
}

async function rootRows(worktreePath: string, range: DiffRange): Promise<GitFileChange[]> {
	const [counts, tracked] = await Promise.all([
		numstat(worktreePath, range),
		gitAsync(worktreePath, changedFileArgs(range, "--raw", true), { raw: true }),
	]);
	if (!tracked.ok) throw diffFailure(tracked.err);
	const rows: GitFileChange[] = [];
	for (const { code, path, gitlink } of parseRaw(tracked.out)) {
		rows.push({
			path,
			status: mapStatus(code),
			...(gitlink ? { submodule: true } : counts.get(path)),
		});
	}
	if (range.untracked) {
		const untracked = await gitAsync(
			worktreePath,
			["ls-files", "-z", "--others", "--exclude-standard"],
			{ raw: true },
		);
		if (!untracked.ok) throw diffFailure(untracked.err);
		const paths = nulFields(untracked.out).filter((path) => path !== "");
		const counts = await untrackedLineCounts(worktreePath, paths);
		for (const path of paths) {
			const added = counts.get(path);
			rows.push({
				path,
				status: "untracked",
				...(added !== undefined && { added, removed: 0 }),
			});
		}
	}
	return rows;
}

async function nestedNumstat(
	worktreePath: string,
): Promise<Map<string, { added: number; removed: number }>> {
	const head = await gitAsync(
		worktreePath,
		["diff", "--numstat", "-z", "--end-of-options", "HEAD", "--"],
		{ raw: true },
	);
	if (head.failure) throw diffFailure(head.err);
	if (head.ok) return parseNumstat(head.out);
	const staged = await gitAsync(
		worktreePath,
		["diff", "--cached", "--numstat", "-z", "--end-of-options", "--"],
		{ raw: true },
	);
	if (!staged.ok) throw diffFailure(staged.err);
	return parseNumstat(staged.out);
}

async function nestedRows(repo: WorktreeRepo): Promise<GitFileChange[]> {
	const [status, counts] = await Promise.all([
		gitAsync(repo.worktreePath, ["status", "--porcelain=v2", "-z", "--untracked-files=all"], {
			raw: true,
		}),
		nestedNumstat(repo.worktreePath),
	]);
	if (!status.ok) throw diffFailure(status.err);
	const rows: GitFileChange[] = [];
	for (const change of parsePorcelainV2(status.out)) {
		if (change.status === "untracked") {
			const added = change.path.endsWith("/")
				? undefined
				: untrackedAdded(repo.worktreePath, change.path);
			rows.push({
				path: change.path,
				status: "untracked",
				...(change.submodule && { submodule: true }),
				...(added !== undefined && { added, removed: 0 }),
			});
			continue;
		}
		rows.push({
			path: change.path,
			status: change.status,
			...(change.submodule ? { submodule: true } : counts.get(change.path)),
		});
	}
	return rows;
}

async function nestedRepoBase(
	repo: WorktreeRepo,
	scope: GitDiffScope | undefined,
): Promise<string> {
	if (scope?.kind === "branch" && scope.repo === repo.path && scope.baseRef) return scope.baseRef;
	const upstream = await gitAsync(repo.worktreePath, [
		"rev-parse",
		"--abbrev-ref",
		"--symbolic-full-name",
		"@{upstream}",
	]);
	return upstream.ok && upstream.out ? upstream.out : resolveDefaultBranch(repo.worktreePath);
}

async function mapLimit<T>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (;;) {
			const index = next++;
			const item = items[index];
			if (item === undefined) return;
			await fn(item);
		}
	});
	await Promise.all(workers);
}

interface PointerRow {
	rel: string;
	dirty: boolean;
}

/** A repository reports the gitlink of a child repository even when only the child's worktree is
 * dirty. Its inner rows are the useful view then, so the pointer row is dropped; a clean child keeps
 * the pointer row (a real pointer change, or an untracked embedded repository). */
function resolvePointerRows(rows: GitFileChange[], kids: PointerRow[]): GitFileChange[] {
	if (kids.length === 0) return rows;
	const out: GitFileChange[] = [];
	for (const row of rows) {
		const exact = kids.find((kid) => kid.rel === row.path);
		if (exact) {
			if (exact.dirty) continue;
			const { added: _added, removed: _removed, ...rest } = row;
			out.push({ ...rest, submodule: true });
			continue;
		}
		if (row.status === "untracked" && row.path.endsWith("/")) {
			const under = kids.filter(
				(kid) => kid.rel === row.path.slice(0, -1) || kid.rel.startsWith(row.path),
			);
			if (under.length > 0) {
				for (const kid of under) {
					if (!kid.dirty) out.push({ path: kid.rel, status: "untracked", submodule: true });
				}
				continue;
			}
		}
		out.push(row);
	}
	return out;
}

export function gitUncommittedPaths(workspaceId: string): string[] {
	const ws = workspace(workspaceId);
	const repos = listWorktreeReposSync(ws, { fresh: true });
	const paths = new Set<string>();
	for (const repo of repos) {
		for (const path of uncommittedPathsInRepo(repo.worktreePath)) {
			paths.add(repo.path === "" ? path : `${repo.path}/${path}`);
		}
	}
	return [...paths].sort();
}

function uncommittedPathsInRepo(cwd: string): string[] {
	const slow = { raw: true, timeoutMs: SLOW_GIT_TIMEOUT_MS };
	const tracked = git(
		cwd,
		["diff", "--name-only", "-z", "--no-ext-diff", "--end-of-options", "HEAD", "--"],
		{ ...slow, action: "read the changed files" },
	);
	const changes = tracked.ok
		? tracked
		: git(
				cwd,
				["diff", "--cached", "--name-only", "-z", "--no-ext-diff", "--end-of-options", "--"],
				{ ...slow, action: "read the changed files" },
			);
	if (!changes.ok) throw diffFailure(changes.err);
	const untracked = git(cwd, ["ls-files", "-z", "--others", "--exclude-standard"], {
		...slow,
		action: "read the untracked files",
	});
	if (!untracked.ok) throw diffFailure(untracked.err);
	return [...new Set([...nulFields(changes.out), ...nulFields(untracked.out)])].sort();
}

function repoPresent(repo: WorktreeRepo): boolean {
	if (repo.path === "") return true;
	try {
		return statSync(join(repo.worktreePath, ".git")) !== undefined;
	} catch {
		return false;
	}
}

/** The 3s discovery cache is a latency trade, not a correctness promise: a row that names a gitlink or
 * an untracked nested directory no discovered repository covers forces one fresh scan, so a newly
 * created submodule or embedded checkout appears on the status read that first observes it. */
function needsDiscoveryRefresh(
	repos: readonly WorktreeRepo[],
	rowsByRepo: ReadonlyMap<string, GitFileChange[]>,
): boolean {
	if (repos.some((repo) => !repoPresent(repo))) return true;
	for (const [ownerPath, rows] of rowsByRepo) {
		for (const row of rows) {
			if (!row.submodule && !row.path.endsWith("/")) continue;
			const relative = row.path.endsWith("/") ? row.path.slice(0, -1) : row.path;
			if (!relative) continue;
			const full = ownerPath === "" ? relative : `${ownerPath}/${relative}`;
			const covered = repos.some(
				(repo) => repo.path !== "" && (repo.path === full || repo.path.startsWith(`${full}/`)),
			);
			if (!covered) return true;
		}
	}
	return false;
}

export async function gitStatus(workspaceId: string, scope?: GitDiffScope): Promise<GitStatus> {
	const ws = workspace(workspaceId);
	const range = await resolveDiffRange(ws, scope);
	const turn = scope?.kind === "turn" ? scope : null;
	const turnPairs = new Map((turn?.nestedTrees ?? []).map((pair) => [pair.repo, pair]));
	const includeNested =
		range.modifiedRef === null &&
		(scope === undefined || scope.kind === "branch" || scope.kind === "uncommitted");
	let repos: WorktreeRepo[];
	if (turnPairs.size > 0) {
		let discovered = await listWorktreeRepos(ws);
		if (
			[...turnPairs.keys()].some(
				(path) => path !== "" && !discovered.some((repo) => repo.path === path),
			)
		) {
			forgetWorktreeRepos(ws.id);
			discovered = await listWorktreeRepos(ws);
		}
		repos = [
			rootRepo(ws),
			...discovered.filter((repo) => repo.path !== "" && turnPairs.has(repo.path)),
		];
	} else if (includeNested) {
		repos = await listWorktreeRepos(ws);
	} else {
		repos = [rootRepo(ws)];
	}

	const buildRows = async (candidateRepos: readonly WorktreeRepo[]) => {
		const rows = new Map<string, GitFileChange[]>();
		rows.set("", await rootRows(ws.worktreePath, range));
		await mapLimit(
			candidateRepos.filter((repo) => repo.path !== ""),
			6,
			async (repo) => {
				const pair = turnPairs.get(repo.path);
				if (turn && pair) {
					const nested = await resolveDiffRange(
						{ ...ws, worktreePath: repo.worktreePath },
						{
							kind: "turn",
							id: turn.id,
							baseTree: pair.baseTree,
							headTree: pair.headTree,
							startedAt: turn.startedAt,
						},
					);
					rows.set(repo.path, await rootRows(repo.worktreePath, nested));
					return;
				}
				if (scope?.kind === "branch" && scope.repo !== undefined && scope.repo === repo.path) {
					const base = await nestedRepoBase(repo, scope);
					const nested = await resolveDiffRange(
						{
							...ws,
							worktreePath: repo.worktreePath,
							baseBranch: base,
							diffBase: base,
						},
						{ kind: "branch" },
					);
					rows.set(repo.path, await rootRows(repo.worktreePath, nested));
					return;
				}
				rows.set(repo.path, await nestedRows(repo));
			},
		);
		return rows;
	};

	let rows = await buildRows(repos);
	if (includeNested && needsDiscoveryRefresh(repos, rows)) {
		forgetWorktreeRepos(ws.id);
		repos = await listWorktreeRepos(ws);
		rows = await buildRows(repos);
	}

	const children = new Map<string, WorktreeRepo[]>();
	for (const repo of repos) {
		if (repo.path === "") continue;
		const parent = ownerOf(repos, repo.path).repo;
		const list = children.get(parent.path) ?? [];
		list.push(repo);
		children.set(parent.path, list);
	}

	const finalized = new Map<string, GitFileChange[]>();
	const subtreeDirty = new Map<string, boolean>();
	for (const repo of [...repos].sort((a, b) => b.path.length - a.path.length)) {
		const own = rows.get(repo.path) ?? [];
		const kids = (children.get(repo.path) ?? []).map(
			(kid): PointerRow => ({
				rel: repo.path === "" ? kid.path : kid.path.slice(repo.path.length + 1),
				dirty: subtreeDirty.get(kid.path) === true,
			}),
		);
		const finalRows = resolvePointerRows(own, kids);
		finalized.set(repo.path, finalRows);
		subtreeDirty.set(repo.path, finalRows.length > 0 || kids.some((kid) => kid.dirty));
	}

	const changes: GitFileChange[] = [];
	for (const repo of repos) {
		for (const row of finalized.get(repo.path) ?? []) {
			changes.push(
				repo.path === "" ? row : { ...row, path: `${repo.path}/${row.path}`, repo: repo.path },
			);
		}
	}
	changes.sort((a, b) => a.path.localeCompare(b.path));
	const branch =
		ws.kind === "default" || ws.kind === "external"
			? await currentBranchAsync(ws.worktreePath)
			: ws.branch;
	const knownRepos = includeNested ? repos : await listWorktreeRepos(ws);
	const repoPaths = knownRepos.filter((repo) => repo.path !== "").map(({ path }) => ({ path }));
	return { branch, changes, ...(repoPaths.length > 0 ? { repos: repoPaths } : {}) };
}

function objectName(ref: string, path: string): string {
	return `${ref}:${process.platform === "win32" ? path.replaceAll("\\", "/") : path}`;
}

function blobArgs(ref: string, path: string): string[] {
	return ["cat-file", "blob", "--", objectName(ref, path)];
}

export function readBlobAt(worktreePath: string, ref: string, path: string): string | null {
	return blobFrom(git(worktreePath, blobArgs(ref, path), { raw: true, onTimeout: "return" }));
}

export function readBlobBytesAt(
	worktreePath: string,
	ref: string,
	path: string,
): Uint8Array | null {
	return strictBlobFrom(
		gitBytes(worktreePath, blobArgs(ref, path), {
			env: { ...nonInteractiveGitEnv(), LC_ALL: "C" },
			action: "read the file diff",
		}),
	);
}

export async function readBlobBytesAtAsync(
	worktreePath: string,
	ref: string,
	path: string,
	opts: { timeoutMs?: number } = {},
): Promise<Uint8Array | null> {
	return strictBlobFrom(
		await gitAsyncBytes(worktreePath, blobArgs(ref, path), {
			env: { ...nonInteractiveGitEnv(), LC_ALL: "C" },
			...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
		}),
	);
}

export interface BlobStream {
	head: Uint8Array;
	body: ReadableStream<Uint8Array>;
}

export async function readBlobStreamAtAsync(
	worktreePath: string,
	ref: string,
	path: string,
	opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<BlobStream | null> {
	if (opts.signal?.aborted) throw new Error("Blob read aborted before it started");
	const run = gitAsyncStream(worktreePath, blobArgs(ref, path), {
		env: { ...nonInteractiveGitEnv(), LC_ALL: "C" },
		...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
	});
	const reader = run.stdout.getReader();
	const abort = () => {
		void reader.cancel(new Error("Blob read aborted by the client")).catch(() => {});
	};
	opts.signal?.addEventListener("abort", abort, { once: true });
	const chunks: Uint8Array[] = [];
	let length = 0;
	while (length < CONTENT_SNIFF_BYTES) {
		let next: Awaited<ReturnType<typeof reader.read>>;
		try {
			next = await reader.read();
		} catch {
			opts.signal?.removeEventListener("abort", abort);
			const exit = await run.exited;
			return strictBlobFrom({
				ok: false,
				out: null,
				err: exit.err,
				...(exit.timedOut ? { failure: "timeout" as const } : {}),
			});
		}
		if (opts.signal?.aborted) {
			opts.signal.removeEventListener("abort", abort);
			await run.exited;
			throw new Error("Blob read aborted by the client");
		}
		if (next.done || next.value === undefined) break;
		chunks.push(next.value);
		length += next.value.byteLength;
	}
	const head = new Uint8Array(Math.min(length, CONTENT_SNIFF_BYTES));
	let offset = 0;
	for (const chunk of chunks) {
		const part = chunk.subarray(0, head.byteLength - offset);
		head.set(part, offset);
		offset += part.byteLength;
		if (offset >= head.byteLength) break;
	}
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
		},
		async pull(controller) {
			const next = await reader.read();
			if (next.done) {
				opts.signal?.removeEventListener("abort", abort);
				controller.close();
			} else controller.enqueue(next.value);
		},
		cancel(reason) {
			opts.signal?.removeEventListener("abort", abort);
			void reader.cancel(reason).catch(() => {});
		},
	});
	return { head, body };
}

export async function readBlobSizeAtAsync(
	worktreePath: string,
	ref: string,
	path: string,
): Promise<number | null> {
	const output = strictBlobFrom(
		await gitAsync(worktreePath, ["cat-file", "-s", "--", objectName(ref, path)], {
			env: { ...nonInteractiveGitEnv(), LC_ALL: "C" },
		}),
	);
	if (output === null) return null;
	if (!/^\d+$/.test(output)) throw new Error("Could not read the file size: invalid git output");
	const size = Number(output);
	if (!Number.isSafeInteger(size))
		throw new Error("Could not read the file size: invalid git output");
	return size;
}

export async function readPathModeAtAsync(
	worktreePath: string,
	ref: string,
	path: string,
): Promise<number | null> {
	const shown = await gitAsync(worktreePath, ["ls-tree", "-z", ref, "--", path], {
		raw: true,
		env: { ...nonInteractiveGitEnv(), LC_ALL: "C" },
	});
	if (!shown.ok) throw new Error(`Could not read the file mode: ${shown.err || "git failed"}`);
	if (shown.out === "") return null;
	const match = /^([0-7]{6}) /.exec(shown.out);
	if (!match?.[1]) throw new Error("Could not read the file mode: invalid git output");
	return Number.parseInt(match[1], 8);
}

function blobIsMissing(stderr: string): boolean {
	return /^fatal: path .+ (?:does not exist in|exists on disk, but not in) .+$/s.test(stderr);
}

function blobFrom<T>(shown: { ok: boolean; out: T; err: string }): T | null {
	if (shown.ok) return shown.out;
	if (!blobIsMissing(shown.err)) log.warn("git blob read failed");
	return null;
}

function strictBlobFrom<T>(shown: {
	ok: boolean;
	out: T;
	err: string;
	failure?: GitResult["failure"];
}): T | null {
	if (shown.ok) return shown.out;
	if (!shown.failure && blobIsMissing(shown.err)) return null;
	throw new Error(`Could not read the file diff: ${shown.err || "git failed"}`);
}

function worktreeBytes(abs: string): Uint8Array | null {
	try {
		return readFileSync(abs);
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
		if (code === "ENOENT") return null;
		throw error;
	}
}

function diffSide(bytes: Uint8Array | null, path: string): { text: string; meta: ResourceMeta } {
	const meta = resourceMeta(bytes, path);
	return { text: bytes !== null && meta.text ? decodeText(bytes) : "", meta };
}

function submoduleSide(oid: string | null, path: string): { text: string; meta: ResourceMeta } {
	const bytes = oid === null ? null : new TextEncoder().encode(`Subproject commit ${oid}\n`);
	return diffSide(bytes, path);
}

function submoduleDiff(
	path: string,
	originalOid: string | null,
	modifiedOid: string | null,
): {
	original: string;
	modified: string;
	originalOid: string | null;
	meta: { original: ResourceMeta; modified: ResourceMeta };
} {
	const original = submoduleSide(originalOid, path);
	const modified = submoduleSide(modifiedOid, path);
	return {
		original: original.text,
		modified: modified.text,
		originalOid: null,
		meta: { original: original.meta, modified: modified.meta },
	};
}

interface GitlinkSides {
	original: string | null;
	modified: string | null;
}

/** The raw diff names both ends of a gitlink. A worktree-ending range whose child is a real repository
 * takes that child's HEAD as the modified side, because raw reports an unstaged pointer move as zeroes. */
async function gitlinkSides(
	repo: WorktreeRepo,
	pathInRepo: string,
	range: DiffRange,
	worktreeChild: WorktreeRepo | null,
): Promise<GitlinkSides | null> {
	const raw = await gitAsync(
		repo.worktreePath,
		[
			...range.listPrefix,
			"--raw",
			"--no-abbrev",
			"-z",
			"--end-of-options",
			...range.listRevs,
			"--",
			pathInRepo,
		],
		{ raw: true },
	);
	if (raw.failure) throw diffFailure(raw.err);
	if (!raw.ok) return null;
	const header = raw.out.split("\0")[0] ?? "";
	if (!header.startsWith(":")) return null;
	const [srcMode, dstMode, srcOid, dstOid] = header.slice(1).split(" ");
	if (srcMode !== "160000" && dstMode !== "160000") return null;
	const zero = (oid: string | undefined) => !oid || /^0+$/.test(oid);
	const modified =
		range.modifiedRef === null
			? worktreeChild
				? await nestedHead(worktreeChild.worktreePath)
				: dstMode === "160000" && !zero(dstOid)
					? (dstOid ?? null)
					: null
			: dstMode === "160000" && !zero(dstOid)
				? (dstOid ?? null)
				: null;
	return {
		original: srcMode === "160000" && !zero(srcOid) ? (srcOid ?? null) : null,
		modified,
	};
}

async function nestedHead(worktreePath: string): Promise<string | null> {
	const head = await gitAsync(worktreePath, ["rev-parse", "--verify", "--quiet", "HEAD"]);
	return head.ok && head.out ? head.out : null;
}

export async function gitDiffFile(
	workspaceId: string,
	path: string,
	scope?: GitDiffScope,
): Promise<{
	original: string;
	modified: string;
	originalOid: string | null;
	meta: { original: ResourceMeta; modified: ResourceMeta };
}> {
	const ws = workspace(workspaceId);
	const repos = await listWorktreeRepos(ws);
	const owner = ownerOf(repos, path);
	const abs = resolveWorktreeFile(workspaceId, path);
	const nestedRoot = repos.find((repo) => repo.path !== "" && repo.path === path);
	const scopeKind = scope?.kind ?? "branch";

	let repoRange: DiffRange;
	if (owner.repo.path === "") {
		repoRange = await resolveDiffRange(ws, scope);
	} else if (scopeKind === "turn" && scope?.kind === "turn") {
		const pair = scope.nestedTrees?.find((entry) => entry.repo === owner.repo.path);
		if (!pair) throw new Error(`This turn has no snapshot for the submodule ${owner.repo.path}.`);
		repoRange = await resolveDiffRange(
			{ ...ws, worktreePath: owner.repo.worktreePath },
			{
				kind: "turn",
				id: scope.id,
				baseTree: pair.baseTree,
				headTree: pair.headTree,
				startedAt: scope.startedAt,
			},
		);
	} else if (scopeKind === "branch" && scope?.kind === "branch" && scope.repo === owner.repo.path) {
		const base = await nestedRepoBase(owner.repo, scope);
		repoRange = await resolveDiffRange(
			{
				...ws,
				worktreePath: owner.repo.worktreePath,
				baseBranch: base,
				diffBase: base,
			},
			{ kind: "branch" },
		);
	} else if (scopeKind === "branch" || scopeKind === "uncommitted") {
		repoRange = await resolveUncommittedRange(owner.repo.worktreePath);
	} else {
		// `pinned` and `commit` name a ref, so they resolve in the owning repository: a review's
		// base-side nested comment pins that repository's own HEAD.
		repoRange = await resolveDiffRange({ ...ws, worktreePath: owner.repo.worktreePath }, scope);
	}

	let worktreeIsDirectory = false;
	try {
		worktreeIsDirectory = statSync(abs).isDirectory();
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
		if (code !== "ENOENT") throw error;
		worktreeIsDirectory = true;
	}

	if (nestedRoot || worktreeIsDirectory) {
		const sides = await gitlinkSides(owner.repo, owner.pathInRepo, repoRange, nestedRoot ?? null);
		if (sides) return submoduleDiff(path, sides.original, sides.modified);
		if (nestedRoot) {
			if (repoRange.modifiedRef !== null) return submoduleDiff(path, null, null);
			return submoduleDiff(path, null, await nestedHead(nestedRoot.worktreePath));
		}
	}

	if (owner.repo.path !== "") {
		const originalRef = repoRange.resolvedOriginalOid;
		const [originalBytes, modifiedBytes] = await Promise.all([
			originalRef
				? readBlobBytesAtAsync(owner.repo.worktreePath, originalRef, owner.pathInRepo)
				: null,
			repoRange.modifiedRef === null
				? worktreeBytes(abs)
				: repoRange.modifiedRef
					? readBlobBytesAtAsync(owner.repo.worktreePath, repoRange.modifiedRef, owner.pathInRepo)
					: null,
		]);
		const original = diffSide(originalBytes, path);
		const modified = diffSide(modifiedBytes, path);
		return {
			original: original.text,
			modified: modified.text,
			originalOid: repoRange.resolvedOriginalOid,
			meta: { original: original.meta, modified: modified.meta },
		};
	}

	const worktreeModified = repoRange.modifiedRef === null ? worktreeBytes(abs) : null;
	const originalRef = repoRange.resolvedOriginalOid ?? repoRange.originalRef;
	const [originalBytes, modifiedBytes] = await Promise.all([
		originalRef
			? readBlobBytesAtAsync(owner.repo.worktreePath, originalRef, owner.pathInRepo)
			: null,
		repoRange.modifiedRef
			? readBlobBytesAtAsync(owner.repo.worktreePath, repoRange.modifiedRef, owner.pathInRepo)
			: worktreeModified,
	]);
	const original = diffSide(originalBytes, path);
	const modified = diffSide(modifiedBytes, path);
	return {
		original: original.text,
		modified: modified.text,
		originalOid: repoRange.resolvedOriginalOid,
		meta: { original: original.meta, modified: modified.meta },
	};
}

const COMMIT_LIST_MAX = 200;
const LOG_SEP = "\u0000";

const LOG_LEADING_FIELDS = 4;

function plainText(raw: string): string {
	let out = "";
	for (const char of raw) {
		const code = char.codePointAt(0) ?? 0;
		if (code < 0x20 || code === 0x7f) continue; // C0 controls + DEL
		if (code >= 0x80 && code <= 0x9f) continue; // C1 controls
		if (code >= 0x200b && code <= 0x200f) continue; // zero-width + LRM/RLM
		if (code >= 0x202a && code <= 0x202e) continue; // bidi embeddings/overrides
		if (code >= 0x2066 && code <= 0x2069) continue; // bidi isolates
		if (code === 0x061c) continue; // Arabic letter mark
		if (code === 0xfeff) continue; // BOM / zero-width no-break space
		if (code === 0x00ad) continue; // soft hyphen
		out += char;
	}
	return out;
}

export async function listCommits(workspaceId: string): Promise<{ commits: GitCommit[] }> {
	const ws = workspace(workspaceId);
	const log = await gitAsync(ws.worktreePath, [
		"log",
		`--max-count=${COMMIT_LIST_MAX}`,
		`--format=%H%x00%h%x00%cI%x00%an%x00%s`,
		"--end-of-options",
		`${diffBaseRef(ws)}..HEAD`,
		"--",
	]);
	if (log.failure) throw new Error(`Could not list commits: ${log.err || "git failed"}`);
	if (!log.ok || !log.out) return { commits: [] };
	const commits: GitCommit[] = [];
	for (const line of log.out.split("\n")) {
		const parts = line.split(LOG_SEP);
		const [sha, shortSha, committedAt, author] = parts;
		if (!sha || !shortSha) continue;
		const subject = parts.slice(LOG_LEADING_FIELDS).join(LOG_SEP);
		commits.push({
			sha,
			shortSha,
			subject: plainText(subject),
			author: plainText(author ?? ""),
			committedAt: committedAt ?? "",
		});
	}
	return { commits };
}

// Commits made in `sinceSha..HEAD`, oldest-first, for the TODO work-window commit-adoption
// (see submodule-server-todos): subagent/loose commits landed while an item was in_progress. `sinceSha`
// comes from the item's own baseline sidecar (`gitHeadSha` at in_progress); it is shape-checked and
// bracketed by `--end-of-options` regardless. A null/unborn baseline head has no range → no commits.
export async function listCommitsSince(
	workspaceId: string,
	sinceSha: string | null,
): Promise<{ sha: string; subject: string }[]> {
	if (!sinceSha || !/^[0-9a-f]{4,64}$/.test(sinceSha)) return [];
	const ws = workspace(workspaceId);
	const log = await gitAsync(ws.worktreePath, [
		"log",
		"--reverse",
		`--max-count=${COMMIT_LIST_MAX}`,
		"--format=%H%x00%s",
		"--end-of-options",
		`${sinceSha}..HEAD`,
		"--",
	]);
	if (log.failure)
		throw new Error(`Could not list commits since ${sinceSha}: ${log.err || "git failed"}`);
	if (!log.ok || !log.out) return [];
	const commits: { sha: string; subject: string }[] = [];
	for (const line of log.out.split("\n")) {
		const sep = line.indexOf(LOG_SEP);
		const sha = sep === -1 ? line : line.slice(0, sep);
		if (!/^[0-9a-f]{40,64}$/.test(sha)) continue;
		commits.push({ sha, subject: plainText(sep === -1 ? "" : line.slice(sep + 1)) });
	}
	return commits;
}

const COMMIT_FILES_MARKER = "\u0001";

/** One commit's `git log --raw -z --numstat` body: raw rows in diff order, `+/−` counts joined by path. */
function parseLogDiffRows(body: string): GitFileChange[] {
	const fields = nulFields(body.startsWith("\n") ? body.slice(1) : body);
	const counts = new Map<string, { added: number; removed: number }>();
	const raw: RawChange[] = [];
	for (let index = 0; index < fields.length; ) {
		const field = fields[index++] ?? "";
		if (field.startsWith(":")) {
			const [srcMode, dstMode, , , code] = field.slice(1).split(" ");
			let path = fields[index++] ?? "";
			if ((code ?? "").startsWith("R") || (code ?? "").startsWith("C"))
				path = fields[index++] ?? "";
			if (path)
				raw.push({
					code: code ?? "",
					path,
					gitlink: srcMode === "160000" || dstMode === "160000",
				});
			continue;
		}
		const firstTab = field.indexOf("\t");
		const secondTab = firstTab < 0 ? -1 : field.indexOf("\t", firstTab + 1);
		if (firstTab < 0 || secondTab < 0) continue;
		const added = Number(field.slice(0, firstTab));
		const removed = Number(field.slice(firstTab + 1, secondTab));
		let path = field.slice(secondTab + 1);
		if (!path) {
			index++;
			path = fields[index++] ?? "";
		}
		if (!path || !Number.isFinite(added) || !Number.isFinite(removed)) continue;
		counts.set(path, { added, removed });
	}
	return raw
		.map(({ code, path, gitlink }) => ({
			path,
			status: mapStatus(code),
			...(gitlink ? { submodule: true } : counts.get(path)),
		}))
		.sort((a, b) => a.path.localeCompare(b.path));
}

/** The `commit:{sha}` scope's rows (see `gitStatus`) for many commits in ONE `git log`, which is what
 * the TODO decoration pass needs — a per-commit scope costs ~5 subprocesses each. A merge commit reads
 * its first-parent diff, the same rows the per-commit scope produces. A sha git cannot resolve, and
 * any sha that is not a full object name, is absent from the map: the caller keeps its thin-artifact
 * fallback, so a GC'd commit still ships no `files`. */
export async function gitCommitFilesBulk(
	workspaceId: string,
	shas: readonly string[],
): Promise<Map<string, GitFileChange[]>> {
	const files = new Map<string, GitFileChange[]>();
	const wanted = [...new Set(shas)].filter((sha) => /^[0-9a-f]{40,64}$/.test(sha));
	if (wanted.length === 0) return files;
	const log = await gitAsync(
		workspace(workspaceId).worktreePath,
		[
			"log",
			"--no-walk=unsorted",
			"--ignore-missing",
			"--diff-merges=first-parent",
			`--format=${COMMIT_FILES_MARKER}%H`,
			"--raw",
			"--numstat",
			"-z",
			"--end-of-options",
			...wanted,
			"--",
		],
		{ raw: true },
	);
	if (log.failure) throw new Error(`Could not read the commit files: ${log.err || "git failed"}`);
	for (const chunk of log.out.split(COMMIT_FILES_MARKER)) {
		const sep = chunk.indexOf("\u0000");
		const sha = sep === -1 ? "" : chunk.slice(0, sep);
		if (!/^[0-9a-f]{40,64}$/.test(sha)) continue;
		files.set(sha, parseLogDiffRows(chunk.slice(sep + 1)));
	}
	return files;
}

export interface OriginUrls {
	fetch: string | null;
	push: string | null;
}

export async function originUrls(worktreePath: string): Promise<OriginUrls> {
	const [url, pushurl] = await Promise.all([
		gitAsync(worktreePath, ["config", "--get", "remote.origin.url"]),
		gitAsync(worktreePath, ["config", "--get", "remote.origin.pushurl"]),
	]);
	const fetch = url.ok && url.out ? url.out : null;
	return { fetch, push: pushurl.ok && pushurl.out ? pushurl.out : fetch };
}

export type PushTargetStatus =
	| { published: false }
	| ({ published: true } & Partial<PushDivergence>);

export async function countPushTargetDivergence(
	worktreePath: string,
	branch: string,
	pushUrl: string,
): Promise<PushTargetStatus> {
	if (!isSafeRef(branch)) throw new Error(`Not a usable git ref: ${branch}`);
	const ref = `refs/heads/${branch}`;
	const listed = await gitAsync(worktreePath, ["ls-remote", "--end-of-options", pushUrl, ref], {
		network: true,
	});
	if (!listed.ok) throw new Error(`Could not read the push target: ${listed.err || "git failed"}`);
	const tip = listed.out
		.split("\n")
		.find((line) => line.endsWith(`\t${ref}`))
		?.split("\t")[0];
	if (!tip) return { published: false };
	const present = async () =>
		(await gitAsync(worktreePath, ["cat-file", "-e", "--end-of-options", `${tip}^{commit}`])).ok;
	if (!(await present())) {
		await gitAsync(
			worktreePath,
			["fetch", "--no-tags", "--no-write-fetch-head", "--end-of-options", pushUrl, ref],
			{ network: true },
		);
		if (!(await present())) return { published: true };
	}
	const counted = await gitAsync(worktreePath, [
		"rev-list",
		"--left-right",
		"--count",
		"--end-of-options",
		`${tip}...HEAD`,
		"--",
	]);
	const [behindStr, aheadStr] = counted.out.split(/\s+/);
	const behind = Number(behindStr);
	const ahead = Number(aheadStr);
	return counted.ok && Number.isSafeInteger(ahead) && Number.isSafeInteger(behind)
		? { published: true, ahead, behind }
		: { published: true };
}

export async function commitsAheadOf(worktreePath: string, baseRef: string): Promise<number> {
	if (!isSafeRef(baseRef)) return 0;
	const counted = await gitAsync(worktreePath, [
		"rev-list",
		"--count",
		"--end-of-options",
		`${baseRef}..HEAD`,
		"--",
	]);
	const count = counted.ok ? Number(counted.out) : 0;
	return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

export interface PushDivergence {
	/** Local commits origin/<branch> lacks (a plain push would deliver these). */
	ahead: number;
	/** Commits on origin/<branch> that HEAD lacks; > 0 means a plain push is non-fast-forward. */
	behind: number;
}

/**
 * How the local branch stands against origin/<branch>: `ahead` (unpushed commits) and `behind` (remote
 * commits HEAD lacks). `behind > 0` means the branch diverged, so only `--force-with-lease` will land.
 * `null` when there is no remote ref yet. With `fetch`, best-effort refreshes origin/<branch> first so the
 * comparison reflects the real remote; offline falls back to the last-known ref rather than failing.
 */
export async function countPushDivergence(
	worktreePath: string,
	branch: string,
	opts?: { fetch?: boolean },
): Promise<PushDivergence | null> {
	if (opts?.fetch && isSafeRef(branch)) {
		await gitAsync(worktreePath, ["fetch", "origin", "--", branch], { network: true });
	}
	const counted = await gitAsync(worktreePath, [
		"rev-list",
		"--left-right",
		"--count",
		"--end-of-options",
		`origin/${branch}...HEAD`,
		"--",
	]);
	if (counted.failure)
		throw new Error(`Could not measure push divergence: ${counted.err || "git failed"}`);
	if (!counted.ok) {
		if ((await remoteRefOidAsync(worktreePath, `origin/${branch}`)) === null) return null;
		throw new Error(`Could not measure push divergence: ${counted.err || "git failed"}`);
	}
	const [behindStr, aheadStr] = counted.out.split(/\s+/);
	const behind = Number(behindStr);
	const ahead = Number(aheadStr);
	if (!Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind) || ahead < 0 || behind < 0)
		return null;
	return { ahead, behind };
}
