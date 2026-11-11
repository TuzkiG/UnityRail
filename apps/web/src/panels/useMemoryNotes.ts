import type { MemoryNotesSnapshot } from "@thinkrail/contracts";
import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "../store";
import { getTransport, supportsMemoryNotes } from "../transport";

export interface MemoryNotesState {
	supported: boolean;
	snapshot: MemoryNotesSnapshot | null;
	loading: boolean;
	reload: () => void;
	readNote: (path: string) => Promise<string>;
	saveNote: (path: string, content: string) => Promise<void>;
}

/** Loads the Basic Memory notes snapshot and reads/saves one note at a time. */
export function useMemoryNotes(): MemoryNotesState {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const supported = supportsMemoryNotes(protocolVersion);
	const [snapshot, setSnapshot] = useState<MemoryNotesSnapshot | null>(null);
	const [loading, setLoading] = useState(false);

	const reload = useCallback(() => {
		if (!supported) return;
		setLoading(true);
		getTransport()
			.request("memory.listNotes", {})
			.then(setSnapshot)
			.catch(() => setSnapshot(null))
			.finally(() => setLoading(false));
	}, [supported]);

	useEffect(() => {
		reload();
	}, [reload]);

	const readNote = useCallback(async (path: string): Promise<string> => {
		const result = await getTransport().request("memory.readNote", { path });
		return result.content;
	}, []);

	const saveNote = useCallback(
		async (path: string, content: string): Promise<void> => {
			await getTransport().request("memory.saveNote", { path, content });
			reload();
		},
		[reload],
	);

	return { supported, snapshot, loading, reload, readNote, saveNote };
}
