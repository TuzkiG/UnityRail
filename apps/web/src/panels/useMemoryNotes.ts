import type { MemoryNotesSnapshot } from "@thinkrail/contracts";
import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "../store";
import { getTransport, supportsMemoryNotes, supportsMemoryProjectNotes } from "../transport";

export interface MemoryNotesState {
	supported: boolean;
	snapshot: MemoryNotesSnapshot | null;
	loading: boolean;
	reload: () => void;
	readNote: (path: string) => Promise<string>;
	saveNote: (path: string, content: string) => Promise<void>;
}

/**
 * Loads one Basic Memory notes snapshot — the shared user-level tree when `projectId` is unset, that
 * project's own folder under it otherwise — and reads/saves one note at a time inside the same scope.
 */
export function useMemoryNotes(projectId?: string): MemoryNotesState {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const supported = projectId
		? supportsMemoryProjectNotes(protocolVersion)
		: supportsMemoryNotes(protocolVersion);
	const [snapshot, setSnapshot] = useState<MemoryNotesSnapshot | null>(null);
	const [loading, setLoading] = useState(false);

	const reload = useCallback(() => {
		if (!supported) return;
		setLoading(true);
		getTransport()
			.request("memory.listNotes", projectId ? { projectId } : {})
			.then(setSnapshot)
			.catch(() => setSnapshot(null))
			.finally(() => setLoading(false));
	}, [projectId, supported]);

	useEffect(() => {
		reload();
	}, [reload]);

	const readNote = useCallback(
		async (path: string): Promise<string> => {
			const result = await getTransport().request(
				"memory.readNote",
				projectId ? { path, projectId } : { path },
			);
			return result.content;
		},
		[projectId],
	);

	const saveNote = useCallback(
		async (path: string, content: string): Promise<void> => {
			await getTransport().request(
				"memory.saveNote",
				projectId ? { path, content, projectId } : { path, content },
			);
			reload();
		},
		[projectId, reload],
	);

	return { supported, snapshot, loading, reload, readNote, saveNote };
}
