import type { MemoryNotesSnapshot } from "@thinkrail/contracts";
import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "../store";
import { getTransport, supportsMemoryProjects } from "../transport";

export interface MemoryNotesState {
	supported: boolean;
	snapshot: MemoryNotesSnapshot | null;
	loading: boolean;
	reload: () => void;
	readNote: (path: string) => Promise<string>;
	saveNote: (path: string, content: string) => Promise<void>;
}

/** Loads one Basic Memory project's notes and reads/saves a note inside it. */
export function useMemoryNotes(project: string | null): MemoryNotesState {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const supported = supportsMemoryProjects(protocolVersion);
	const [snapshot, setSnapshot] = useState<MemoryNotesSnapshot | null>(null);
	const [loading, setLoading] = useState(false);

	const reload = useCallback(() => {
		if (!supported || !project) {
			setSnapshot(null);
			return;
		}
		setLoading(true);
		getTransport()
			.request("memory.listNotes", { project })
			.then((next) => setSnapshot(next.project === project ? next : null))
			.catch(() => setSnapshot(null))
			.finally(() => setLoading(false));
	}, [project, supported]);

	useEffect(() => {
		reload();
	}, [reload]);

	const readNote = useCallback(
		async (path: string): Promise<string> => {
			if (!project) throw new Error("no Basic Memory project selected");
			const result = await getTransport().request("memory.readNote", { project, path });
			return result.content;
		},
		[project],
	);

	const saveNote = useCallback(
		async (path: string, content: string): Promise<void> => {
			if (!project) throw new Error("no Basic Memory project selected");
			await getTransport().request("memory.saveNote", { project, path, content });
			reload();
		},
		[project, reload],
	);

	return { supported, snapshot, loading, reload, readNote, saveNote };
}
