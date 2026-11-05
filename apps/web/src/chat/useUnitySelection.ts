import { UNITY_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { sameUnitySelection, type UnityEditorSelection, unitySelectionOf } from "./unitySelection";

const POLL_INTERVAL_MS = 3_000;
const HIDDEN_POLL_INTERVAL_MS = 30_000;

/**
 * The live Unity Editor selection behind the composer chip. Polls `unity.status` (the status-only read)
 * while the chat is mounted, and stops for a workspace that is not a Unity project; a transient failure
 * keeps the last chip and retries. Older hosts omit the method, so the poll waits for a host that
 * advertises the Unity protocol.
 */
export function useUnitySelection(workspaceId: string): UnityEditorSelection | null {
	const supported = useAppStore(
		(state) => state.protocolVersion !== null && state.protocolVersion >= UNITY_PROTOCOL_VERSION,
	);
	const [selection, setSelection] = useState<UnityEditorSelection | null>(null);
	useEffect(() => {
		if (!supported) return;
		let disposed = false;
		let timer: number | undefined;
		setSelection(null);
		const schedule = (delay: number): void => {
			timer = window.setTimeout(tick, delay);
		};
		const tick = (): void => {
			void getTransport()
				.request("unity.status", { workspaceId })
				.then((status) => {
					if (disposed || !status.isUnityProject) return;
					const next = unitySelectionOf(status);
					setSelection((current) => (sameUnitySelection(current, next) ? current : next));
					schedule(document.hidden ? HIDDEN_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
				})
				.catch(() => {
					if (!disposed) schedule(document.hidden ? HIDDEN_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
				});
		};
		tick();
		return () => {
			disposed = true;
			if (timer !== undefined) window.clearTimeout(timer);
		};
	}, [workspaceId, supported]);
	return supported ? selection : null;
}
