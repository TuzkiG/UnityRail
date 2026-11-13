import type { GitDiffScope, ResourceMeta } from "@thinkrail/contracts";
import { useAppStore } from "../store";
import { scopeKey } from "./changesModel";

export interface SectionContent {
	original: string;
	modified: string;
	meta: { original: ResourceMeta; modified: ResourceMeta } | undefined;
	originalOid: string | null | undefined;
	loadedTick: number;
	loadedTarget: string;
}

type DiffFileResult = Omit<SectionContent, "loadedTick" | "loadedTarget">;

export interface SectionContentCache {
	get(path: string): SectionContent | undefined;
	set(path: string, content: SectionContent): void;
	load(
		path: string,
		read: () => Promise<DiffFileResult>,
		loadedTick: number,
		loadedTarget: string,
	): Promise<SectionContent>;
}

export const SECTION_CONTENT_CACHE_SIZE = 64;

interface CacheEntry {
	workspaceId: string;
	cache: SectionContentCache;
}

const caches = new Map<string, CacheEntry>();
let watchingRemovals = false;

const cacheKey = (workspaceId: string, scope: GitDiffScope, targetRef: string) =>
	`${workspaceId}\u0000${scopeKey(scope)}\u0000${targetRef}`;

function forgetRemovedWorkspaces(removed: Record<string, true>): void {
	for (const [key, entry] of caches) if (removed[entry.workspaceId]) caches.delete(key);
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

/** The section-content cache for one diff view; remounting the review tab reuses it. */
export function sectionContentCacheFor(
	workspaceId: string,
	scope: GitDiffScope,
	targetRef: string,
): SectionContentCache {
	const key = cacheKey(workspaceId, scope, targetRef);
	const current = caches.get(key);
	if (current) {
		caches.delete(key);
		caches.set(key, current);
		return current.cache;
	}
	if (useAppStore.getState().removedWorkspaceIds[workspaceId]) return createSectionContentCache();
	watchRemovals();
	const cache = createSectionContentCache();
	caches.set(key, { workspaceId, cache });
	for (const oldest of caches.keys()) {
		if (caches.size <= SECTION_CONTENT_CACHE_SIZE) break;
		caches.delete(oldest);
	}
	return cache;
}

export function createSectionContentCache(): SectionContentCache {
	const content = new Map<string, SectionContent>();
	const pending = new Map<
		string,
		{ loadedTick: number; loadedTarget: string; promise: Promise<SectionContent> }
	>();
	return {
		get: (path) => content.get(path),
		set: (path, next) => {
			pending.delete(path);
			content.set(path, next);
		},
		load(path, read, loadedTick, loadedTarget) {
			const inFlight = pending.get(path);
			if (inFlight?.loadedTick === loadedTick && inFlight.loadedTarget === loadedTarget) {
				return inFlight.promise;
			}
			const promise = read()
				.then((fresh) => {
					const next = { ...fresh, loadedTick, loadedTarget };
					if (pending.get(path)?.promise === promise) content.set(path, next);
					return next;
				})
				.finally(() => {
					if (pending.get(path)?.promise === promise) pending.delete(path);
				});
			pending.set(path, { loadedTick, loadedTarget, promise });
			return promise;
		},
	};
}
