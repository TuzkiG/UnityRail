import type { FileNode } from "@thinkrail/contracts";
import { useAppStore } from "../store";
import type { ResolvedFolderChain } from "./folderChains";

export const FILES_TREE_CACHE_SIZE = 128;

interface RootEntry {
	kind: "root";
	workspaceId: string;
	nodes: FileNode[];
}

interface ChainEntry {
	kind: "chain";
	workspaceId: string;
	chain: ResolvedFolderChain<FileNode>;
}

type Entry = RootEntry | ChainEntry;

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
let watchingRemovals = false;

const rootKey = (workspaceId: string, repo: string) => `${workspaceId}\u0000root\u0000${repo}`;
const chainKey = (workspaceId: string, repo: string, path: string) =>
	`${workspaceId}\u0000chain\u0000${repo}\u0000${path}`;

function forgetRemovedWorkspaces(removed: Record<string, true>): void {
	for (const [key, entry] of entries) if (removed[entry.workspaceId]) entries.delete(key);
}

function watchRemovals(): void {
	if (watchingRemovals) return;
	watchingRemovals = true;
	useAppStore.subscribe((state, previous) => {
		if (state.removedWorkspaceIds !== previous.removedWorkspaceIds) {
			forgetRemovedWorkspaces(state.removedWorkspaceIds);
		}
	});
}

function remember(key: string, entry: Entry): void {
	if (useAppStore.getState().removedWorkspaceIds[entry.workspaceId]) return;
	watchRemovals();
	entries.delete(key);
	entries.set(key, entry);
	for (const oldest of entries.keys()) {
		if (entries.size <= FILES_TREE_CACHE_SIZE) break;
		entries.delete(oldest);
	}
}

function peek(key: string): Entry | null {
	const entry = entries.get(key);
	if (!entry) return null;
	entries.delete(key);
	entries.set(key, entry);
	return entry;
}

export function peekRootDir(workspaceId: string, repo: string): FileNode[] | null {
	const entry = peek(rootKey(workspaceId, repo));
	return entry?.kind === "root" ? entry.nodes : null;
}

export function peekFolderChain(
	workspaceId: string,
	repo: string,
	path: string,
): ResolvedFolderChain<FileNode> | null {
	const entry = peek(chainKey(workspaceId, repo, path));
	return entry?.kind === "chain" ? entry.chain : null;
}

export function readRootDir(
	workspaceId: string,
	repo: string,
	read: () => Promise<FileNode[]>,
): Promise<FileNode[]> {
	const key = rootKey(workspaceId, repo);
	const pending = inFlight.get(key);
	if (pending) return pending as Promise<FileNode[]>;
	const promise: Promise<FileNode[]> = read()
		.then((nodes) => {
			remember(key, { kind: "root", workspaceId, nodes });
			return nodes;
		})
		.finally(() => {
			if (inFlight.get(key) === promise) inFlight.delete(key);
		});
	inFlight.set(key, promise);
	return promise;
}

export function readFolderChain(
	workspaceId: string,
	repo: string,
	path: string,
	read: () => Promise<ResolvedFolderChain<FileNode>>,
): Promise<ResolvedFolderChain<FileNode>> {
	const key = chainKey(workspaceId, repo, path);
	const pending = inFlight.get(key);
	if (pending) return pending as Promise<ResolvedFolderChain<FileNode>>;
	const promise: Promise<ResolvedFolderChain<FileNode>> = read()
		.then((chain) => {
			remember(key, { kind: "chain", workspaceId, chain });
			return chain;
		})
		.finally(() => {
			if (inFlight.get(key) === promise) inFlight.delete(key);
		});
	inFlight.set(key, promise);
	return promise;
}
