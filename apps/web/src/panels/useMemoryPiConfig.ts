import type { MemoryPiConfig, MemoryPiConfigPatch } from "@thinkrail/contracts";
import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "../store";
import { getTransport, supportsMemoryPiConfig } from "../transport";

export interface MemoryPiConfigState {
	supported: boolean;
	config: MemoryPiConfig | null;
	saving: boolean;
	save: (patch: MemoryPiConfigPatch) => Promise<MemoryPiConfig | null>;
	reload: () => void;
}

/** Reads and writes one project's `.pi/basic-memory.json` (the Pi package's own config). */
export function useMemoryPiConfig(projectId: string | undefined): MemoryPiConfigState {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const supported = supportsMemoryPiConfig(protocolVersion) && projectId !== undefined;
	const [config, setConfig] = useState<MemoryPiConfig | null>(null);
	const [saving, setSaving] = useState(false);

	const reload = useCallback(() => {
		if (!supported || !projectId) return;
		getTransport()
			.request("memory.piConfig", { projectId })
			.then(setConfig)
			.catch(() => setConfig(null));
	}, [projectId, supported]);

	useEffect(() => {
		reload();
	}, [reload]);

	const save = useCallback(
		async (patch: MemoryPiConfigPatch): Promise<MemoryPiConfig | null> => {
			if (!supported || !projectId) return null;
			setSaving(true);
			try {
				const saved = await getTransport().request("memory.savePiConfig", {
					projectId,
					config: patch,
				});
				setConfig(saved);
				setSaving(false);
				return saved;
			} catch {
				setSaving(false);
				return null;
			}
		},
		[projectId, supported],
	);

	return { supported, config, saving, save, reload };
}
