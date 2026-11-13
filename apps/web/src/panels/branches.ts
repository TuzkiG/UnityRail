import type { BranchList } from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { getTransport } from "../transport";

const NO_BRANCHES: BranchList = { local: [], remote: [], defaultBranch: "" };

export const BRANCH_LIST_TTL_MS = 30_000;
export const BRANCH_LIST_CACHE_SIZE = 16;

interface BranchOptions {
	workspaceId?: string;
	repo?: string;
}

export interface CachedBranchList {
	list: BranchList;
	at: number;
}

const entries = new Map<string, CachedBranchList>();
const inFlight = new Map<string, Promise<BranchList | null>>();

const branchListKey = (projectId: string, options: BranchOptions) =>
	`${projectId}\u0000${options.workspaceId ?? ""}\u0000${options.repo ?? ""}`;

function remember(key: string, list: BranchList, at: number): void {
	entries.delete(key);
	entries.set(key, { list, at });
	for (const oldest of entries.keys()) {
		if (entries.size <= BRANCH_LIST_CACHE_SIZE) break;
		entries.delete(oldest);
	}
}

export function peekBranchList(
	projectId: string,
	options: BranchOptions = {},
): CachedBranchList | null {
	const key = branchListKey(projectId, options);
	const entry = entries.get(key);
	if (!entry) return null;
	entries.delete(key);
	entries.set(key, entry);
	return entry;
}

export function branchListIsFresh(
	cached: CachedBranchList | null,
	now: number = Date.now(),
): cached is CachedBranchList {
	return cached !== null && now - cached.at < BRANCH_LIST_TTL_MS;
}

/** One request per project/workspace/repo, so both branch pickers share a mount-time read. */
export function readBranchList(
	projectId: string,
	options: BranchOptions = {},
	at: number = Date.now(),
): Promise<BranchList | null> {
	const key = branchListKey(projectId, options);
	const pending = inFlight.get(key);
	if (pending) return pending;
	const promise: Promise<BranchList | null> = getTransport()
		.request("git.listBranches", { projectId, ...options })
		.then((list) => {
			remember(key, list, at);
			return list;
		})
		.catch(() => null)
		.finally(() => {
			if (inFlight.get(key) === promise) inFlight.delete(key);
		});
	inFlight.set(key, promise);
	return promise;
}

export function useBranchList(
	projectId: string | null,
	onLoaded?: (list: BranchList) => void,
	options: { workspaceId?: string; repo?: string } = {},
): { branches: BranchList | null; failed: boolean; refreshing: boolean; refresh: () => void } {
	const [branches, setBranches] = useState<BranchList | null>(null);
	const [failed, setFailed] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const latestOnLoaded = useRef(onLoaded);
	latestOnLoaded.current = onLoaded;
	const generation = useRef(0);

	useEffect(() => {
		const mine = ++generation.current;
		setFailed(false);
		setRefreshing(false);
		if (!projectId) {
			setBranches(null);
			return;
		}
		const cached = peekBranchList(projectId, options);
		const cachedList = cached?.list ?? null;
		setBranches(cachedList);
		if (branchListIsFresh(cached)) {
			latestOnLoaded.current?.(cached.list);
			return;
		}
		void readBranchList(projectId, options).then((loaded) => {
			if (generation.current !== mine) return;
			if (loaded === null) {
				setFailed(true);
				const fallback = cachedList ?? NO_BRANCHES;
				setBranches(fallback);
				latestOnLoaded.current?.(fallback);
				return;
			}
			setBranches(loaded);
			latestOnLoaded.current?.(loaded);
		});
		return () => {
			generation.current += 1;
		};
	}, [projectId, options.workspaceId, options.repo]);

	const refresh = useCallback(() => {
		if (!projectId) return;
		const mine = ++generation.current;
		setRefreshing(true);
		void readBranchList(projectId, options)
			.then((loaded) => {
				if (generation.current !== mine) return;
				if (loaded === null) {
					setFailed(true);
					return;
				}
				setBranches(loaded);
				setFailed(false);
				latestOnLoaded.current?.(loaded);
			})
			.finally(() => {
				if (generation.current === mine) setRefreshing(false);
			});
	}, [projectId, options.workspaceId, options.repo]);

	return { branches, failed, refreshing, refresh };
}
