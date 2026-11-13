import type { MemoryEngineStatus } from "@thinkrail/contracts";
import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "../store";
import { getTransport, supportsMemoryProjects } from "../transport";

const POLL_INTERVAL_MS = 3_000;
const POLL_BUDGET_MS = 60_000;

export interface MemoryEngineState {
	supported: boolean;
	status: MemoryEngineStatus | null;
	checking: boolean;
	install: () => Promise<boolean>;
	recheck: () => void;
}

/** Probes the Memory engine on mount and after a terminal install; the page renders the result. */
export function useMemoryEngine(): MemoryEngineState {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const supported = supportsMemoryProjects(protocolVersion);
	const [status, setStatus] = useState<MemoryEngineStatus | null>(null);
	const [checking, setChecking] = useState(false);

	const probe = useCallback(async () => {
		if (!supported) return;
		setChecking(true);
		try {
			setStatus(await getTransport().request("memory.status", {}));
		} catch {
			setStatus(null);
		}
		setChecking(false);
	}, [supported]);

	useEffect(() => {
		void probe();
	}, [probe]);

	const install = useCallback(async (): Promise<boolean> => {
		try {
			await getTransport().request("memory.install", {});
		} catch {
			return false;
		}
		const deadline = Date.now() + POLL_BUDGET_MS;
		const poll = async () => {
			await probe();
			if (Date.now() >= deadline) return;
			setTimeout(() => {
				void poll();
			}, POLL_INTERVAL_MS);
		};
		void poll();
		return true;
	}, [probe]);

	return { supported, status, checking, install, recheck: () => void probe() };
}
