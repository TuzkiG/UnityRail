import type { GitDiffScope, Workspace } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { type GitResult, git, gitAsync, throwOnTimeout } from "./gitExec";

export function diffBaseRef(ws: Pick<Workspace, "baseBranch" | "diffBase">): string {
	return ws.diffBase ?? ws.baseBranch;
}

export interface DiffRange {
	listPrefix: string[];
	listRevs: string[];
	untracked: boolean;
	originalRef: string | null;
	modifiedRef: string | null;
	resolvedOriginalOid: string | null;
}

const OID = /^[0-9a-f]{4,64}$/;
/** Discovery caps a workspace at 128 repositories; a scope can never legitimately name more. */
const MAX_NESTED_TREES = 512;

function throwExecutionFailure(result: GitResult): void {
	if (result.failure)
		throw new Error(`Could not resolve the diff range: ${result.err || "git failed"}`);
}

function commitOidArgs(ref: string): string[] {
	return ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`];
}

function commitOidFrom(result: GitResult): string | null {
	return result.ok && result.out ? result.out : null;
}

export function resolveCommitOid(worktreePath: string, ref: string): string | null {
	return commitOidFrom(git(worktreePath, commitOidArgs(ref), { action: `resolve ${ref}` }));
}

async function resolveCommitOidAsync(worktreePath: string, ref: string): Promise<string | null> {
	return commitOidFrom(
		throwOnTimeout(await gitAsync(worktreePath, commitOidArgs(ref)), `resolve ${ref}`),
	);
}

/** HEAD → worktree for one repository, including an unborn HEAD (everything it has staged is an
 * addition then). Used for a nested repository, which has no relationship to the workspace's base. */
export async function resolveUncommittedRange(worktreePath: string): Promise<DiffRange> {
	const head = await gitAsync(worktreePath, ["rev-parse", "--verify", "--quiet", "HEAD"]);
	if (head.failure)
		throw new Error(`Could not resolve the diff range: ${head.err || "git failed"}`);
	if (head.ok && head.out) {
		return {
			listPrefix: ["diff"],
			listRevs: ["HEAD"],
			untracked: true,
			originalRef: "HEAD",
			modifiedRef: null,
			resolvedOriginalOid: head.out,
		};
	}
	return {
		listPrefix: ["diff", "--cached"],
		listRevs: [],
		untracked: true,
		originalRef: null,
		modifiedRef: null,
		resolvedOriginalOid: null,
	};
}

export async function resolveDiffRange(
	ws: Pick<Workspace, "baseBranch" | "diffBase" | "worktreePath">,
	scope: GitDiffScope = { kind: "branch" },
): Promise<DiffRange> {
	if (scope.kind === "uncommitted") {
		return {
			listPrefix: ["diff"],
			listRevs: ["HEAD"],
			untracked: true,
			originalRef: "HEAD",
			modifiedRef: null,
			resolvedOriginalOid: await resolveCommitOidAsync(ws.worktreePath, "HEAD"),
		};
	}
	if (scope.kind === "pinned") {
		if (!OID.test(scope.baseRef)) throw new Error(`Not a commit id: ${scope.baseRef}`);
		const resolved = await gitAsync(ws.worktreePath, [
			"rev-parse",
			"--verify",
			"--quiet",
			`${scope.baseRef}^{commit}`,
		]);
		throwExecutionFailure(resolved);
		if (!resolved.ok || !resolved.out)
			throw new CodedError("UNKNOWN_COMMIT", `Unknown commit: ${scope.baseRef}`);
		return {
			listPrefix: ["diff"],
			listRevs: [resolved.out],
			untracked: true,
			originalRef: resolved.out,
			modifiedRef: null,
			resolvedOriginalOid: resolved.out,
		};
	}
	if (scope.kind === "turn") {
		if (!OID.test(scope.baseTree) || !OID.test(scope.headTree))
			throw new Error(`Not a tree id: ${scope.baseTree}..${scope.headTree}`);
		const nested = scope.nestedTrees;
		if (nested !== undefined && (!Array.isArray(nested) || nested.length > MAX_NESTED_TREES))
			throw new Error("This turn's nested snapshots are not a bounded list.");
		for (const pair of nested ?? []) {
			if (
				typeof pair.repo !== "string" ||
				!pair.repo ||
				pair.repo.startsWith("/") ||
				pair.repo.split("/").includes("..") ||
				!OID.test(pair.baseTree) ||
				!OID.test(pair.headTree)
			)
				throw new Error("This turn's nested snapshot is malformed.");
		}
		for (const tree of [scope.baseTree, scope.headTree]) {
			const resolved = await gitAsync(ws.worktreePath, [
				"rev-parse",
				"--verify",
				"--quiet",
				`${tree}^{tree}`,
			]);
			throwExecutionFailure(resolved);
			if (!resolved.ok || !resolved.out)
				throw new CodedError(
					"UNKNOWN_COMMIT",
					"That turn's snapshot is no longer in this repository",
				);
		}
		return {
			listPrefix: ["diff"],
			listRevs: [scope.baseTree, scope.headTree],
			untracked: false,
			originalRef: scope.baseTree,
			modifiedRef: scope.headTree,
			resolvedOriginalOid: scope.baseTree,
		};
	}
	if (scope.kind === "commit") {
		if (!OID.test(scope.sha)) throw new Error(`Not a commit id: ${scope.sha}`);
		const resolved = await gitAsync(ws.worktreePath, [
			"rev-parse",
			"--verify",
			"--quiet",
			`${scope.sha}^{commit}`,
		]);
		throwExecutionFailure(resolved);
		if (!resolved.ok || !resolved.out)
			throw new CodedError("UNKNOWN_COMMIT", `Unknown commit: ${scope.sha}`);
		const sha = resolved.out;
		const parent = await gitAsync(ws.worktreePath, [
			"rev-parse",
			"--verify",
			"--quiet",
			`${sha}^^{commit}`,
		]);
		throwExecutionFailure(parent);
		if (!parent.ok || !parent.out) {
			return {
				listPrefix: ["show", "--format="],
				listRevs: [sha],
				untracked: false,
				originalRef: null,
				modifiedRef: sha,
				resolvedOriginalOid: null,
			};
		}
		return {
			listPrefix: ["diff"],
			listRevs: [parent.out, sha],
			untracked: false,
			originalRef: parent.out,
			modifiedRef: sha,
			resolvedOriginalOid: parent.out,
		};
	}
	const base = diffBaseRef(ws);
	const mergeBase = await gitAsync(ws.worktreePath, [
		"merge-base",
		"--end-of-options",
		base,
		"HEAD",
	]);
	throwExecutionFailure(mergeBase);
	const resolvedForkPoint = mergeBase.ok && mergeBase.out ? mergeBase.out : null;
	const forkPoint = resolvedForkPoint ?? base;
	return {
		listPrefix: ["diff"],
		listRevs: [forkPoint],
		untracked: true,
		originalRef: forkPoint,
		modifiedRef: null,
		resolvedOriginalOid: resolvedForkPoint ?? (await resolveCommitOidAsync(ws.worktreePath, base)),
	};
}

export function changedFileArgs(
	range: DiffRange,
	mode: "--name-status" | "--raw" | "--numstat" | "--shortstat",
	nul = false,
): string[] {
	return [
		...range.listPrefix,
		mode,
		...(nul ? ["-z"] : []),
		"--end-of-options",
		...range.listRevs,
		"--",
	];
}
