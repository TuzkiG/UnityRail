import {
	closeSync,
	type Dirent,
	lstatSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	realpathSync,
	statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileNode, ResourceMeta } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { loadWorkspaces } from "../persistence";
import { decodeText, resourceMeta } from "./content";

function isContained(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function posixRelative(root: string, abs: string): string {
	return relative(root, abs).split(sep).join("/");
}

export function workspaceRelativePath(root: string, path: string): string | null {
	const base = resolve(root);
	const abs = resolve(base, path);
	return isContained(base, abs) ? posixRelative(base, abs) : null;
}

function isGitMetadataPath(root: string, candidate: string): boolean {
	return relative(root, candidate).split(sep).includes(".git");
}

/** A directory link inside the worktree whose target is a Git repository is a deliberate business
 * mount (the framework/business split). Its files stay readable through the link path; a link to
 * anything else still cannot escape the worktree. */
function linkedGitAncestor(root: string, abs: string): boolean {
	const base = resolve(root);
	let cursor = abs;
	while (true) {
		try {
			if (lstatSync(cursor).isSymbolicLink()) {
				const real = realpathSync(cursor);
				try {
					if (statSync(join(real, ".git"))) return true;
				} catch {}
			}
		} catch {}
		if (cursor === base) return false;
		const parent = dirname(cursor);
		if (parent === cursor || !isContained(base, parent)) return false;
		cursor = parent;
	}
}

function assertExistingAncestorContained(root: string, abs: string): void {
	const realRoot = realpathSync(root);
	let cursor = abs;
	while (true) {
		let real: string;
		try {
			real = realpathSync(cursor);
		} catch (error) {
			const code =
				typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
			if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
			const parent = dirname(cursor);
			if (parent === cursor) throw error;
			cursor = parent;
			continue;
		}
		if (!isContained(realRoot, real) && !linkedGitAncestor(root, abs)) {
			throw new Error("Path escapes the worktree");
		}
		if (isGitMetadataPath(realRoot, real)) throw new Error("The .git directory is not readable");
		return;
	}
}

function resolveUnderRoot(root: string, path: string, followLeaf: boolean): string {
	const abs = resolve(root, path);
	if (!isContained(resolve(root), abs)) throw new Error("Path escapes the worktree");
	if (isGitMetadataPath(resolve(root), abs)) throw new Error("The .git directory is not readable");
	assertExistingAncestorContained(root, followLeaf ? abs : dirname(abs));
	return abs;
}

function resolveInWorktree(
	workspaceId: string,
	path: string,
	followLeaf: boolean,
): { root: string; abs: string } {
	const ws = loadWorkspaces().find((workspace) => workspace.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);
	return { root: ws.worktreePath, abs: resolveUnderRoot(ws.worktreePath, path, followLeaf) };
}

export function readableFileSize(root: string, path: string): number | "missing" | null {
	try {
		const stats = statSync(resolveUnderRoot(root, path, true));
		return stats.isFile() ? stats.size : "missing";
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
		return code === undefined || code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP"
			? "missing"
			: null;
	}
}

/** A link lists as a directory when its target is one — inside the worktree, or a deliberate business
 * mount: a link whose target is a Git repository (see `linkedGitAncestor`). */
function entryKind(root: string, dir: string, entry: Dirent): FileNode["kind"] {
	if (entry.isDirectory()) return "dir";
	if (!entry.isSymbolicLink()) return "file";
	const target = join(dir, entry.name);
	try {
		if (!statSync(target).isDirectory()) return "file";
		const contained = isContained(realpathSync(root), realpathSync(target));
		return contained || linkedGitAncestor(root, target) ? "dir" : "file";
	} catch {
		return "file";
	}
}

export function readDir(workspaceId: string, path: string): FileNode[] {
	const { root, abs } = resolveInWorktree(workspaceId, path, true);

	return readdirSync(abs, { withFileTypes: true })
		.filter((entry) => entry.name !== ".git")
		.map((entry): FileNode => {
			const absEntry = join(abs, entry.name);

			return {
				path: posixRelative(root, absEntry),
				name: entry.name,
				kind: entryKind(root, abs, entry),
			};
		})
		.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
}

const BOUNDED_READ_CHUNK = 64 * 1024;

function readBounded(abs: string, maxBytes: number): Uint8Array {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
		throw new Error("maxBytes must be a non-negative integer");
	}
	const fd = openSync(abs, "r");
	try {
		const chunks: Buffer[] = [];
		let total = 0;
		while (true) {
			const chunk = Buffer.allocUnsafe(Math.min(BOUNDED_READ_CHUNK, maxBytes + 1 - total));
			const read = readSync(fd, chunk, 0, chunk.length, total);
			if (read === 0) break;
			chunks.push(chunk.subarray(0, read));
			total += read;
			if (total > maxBytes) {
				throw new CodedError("FILE_TOO_LARGE", "The file is larger than the read allows");
			}
		}
		return Buffer.concat(chunks, total);
	} finally {
		closeSync(fd);
	}
}

export function readFile(
	workspaceId: string,
	path: string,
	options: { readonly maxBytes?: number } = {},
): { content: string; meta: ResourceMeta } {
	const { abs } = resolveInWorktree(workspaceId, path, true);
	const bytes =
		options.maxBytes === undefined ? readFileSync(abs) : readBounded(abs, options.maxBytes);
	const meta = resourceMeta(bytes, path);
	return { content: meta.text ? decodeText(bytes) : "", meta };
}

export function resolveWorktreeFile(
	workspaceId: string,
	path: string,
	options: { followLeaf?: boolean } = {},
): string {
	return resolveInWorktree(workspaceId, path, options.followLeaf !== false).abs;
}
