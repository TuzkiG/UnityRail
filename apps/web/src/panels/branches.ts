import type { BranchList } from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { getTransport } from "../transport";

const NO_BRANCHES: BranchList = { local: [], remote: [], defaultBranch: "" };

async function listBranchesOrEmpty(
	projectId: string,
	options: { workspaceId?: string; repo?: string } = {},
): Promise<BranchList | null> {
	try {
		return await getTransport().request("git.listBranches", { projectId, ...options });
	} catch {
		return null;
	}
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
		setBranches(null);
		setFailed(false);
		setRefreshing(false);
		if (!projectId) return;
		void listBranchesOrEmpty(projectId, options).then((loaded) => {
			if (generation.current !== mine) return;
			const list = loaded ?? NO_BRANCHES;
			setBranches(list);
			setFailed(loaded === null);
			latestOnLoaded.current?.(list);
		});
		return () => {
			generation.current += 1;
		};
	}, [projectId, options.workspaceId, options.repo]);

	const refresh = useCallback(() => {
		if (!projectId) return;
		const mine = ++generation.current;
		setRefreshing(true);
		getTransport()
			.request("git.listBranches", { projectId, ...options })
			.then((list) => {
				if (generation.current !== mine) return;
				setBranches(list);
				setFailed(false);
			})
			.catch(() => {})
			.finally(() => {
				if (generation.current === mine) setRefreshing(false);
			});
	}, [projectId, options.workspaceId, options.repo]);

	return { branches, failed, refreshing, refresh };
}
