import type { MemoryProject, MemoryProjectsSnapshot } from "@thinkrail/contracts";
import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "../store";
import { getTransport, supportsMemoryProjects } from "../transport";

export interface MemoryProjectsState {
	supported: boolean;
	snapshot: MemoryProjectsSnapshot | null;
	loading: boolean;
	reload: () => void;
	reveal: (project: string) => Promise<void>;
}

/** Loads the Basic Memory project registry (its `config.json`) and reveals a project folder. */
export function useMemoryProjects(): MemoryProjectsState {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const supported = supportsMemoryProjects(protocolVersion);
	const [snapshot, setSnapshot] = useState<MemoryProjectsSnapshot | null>(null);
	const [loading, setLoading] = useState(false);

	const reload = useCallback(() => {
		if (!supported) return;
		setLoading(true);
		getTransport()
			.request("memory.projects", {})
			.then(setSnapshot)
			.catch(() => setSnapshot(null))
			.finally(() => setLoading(false));
	}, [supported]);

	useEffect(() => {
		reload();
	}, [reload]);

	const reveal = useCallback(async (project: string) => {
		await getTransport().request("memory.revealProject", { project });
	}, []);

	return { supported, snapshot, loading, reload, reveal };
}

/** The project a viewer should start on: the named one, else the registry default. */
export function preferredMemoryProject(
	snapshot: MemoryProjectsSnapshot | null,
	preferredName?: string | null,
): MemoryProject | null {
	if (!snapshot || snapshot.projects.length === 0) return null;
	const wanted = preferredName?.trim().toLowerCase();
	if (wanted) {
		const exact = snapshot.projects.find((project) => project.name.toLowerCase() === wanted);
		if (exact) return exact;
		// A Basic Memory project is often named after the repo (or its `docs`), so accept the longer
		// name containing the shorter one once both are long enough to mean something.
		if (wanted.length >= 3) {
			const partial = snapshot.projects.find((project) => {
				const name = project.name.toLowerCase();
				return name.length >= 3 && (name.includes(wanted) || wanted.includes(name));
			});
			if (partial) return partial;
		}
	}
	return snapshot.projects.find((project) => project.isDefault) ?? snapshot.projects[0] ?? null;
}
