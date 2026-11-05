import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	findUnityProjectRoot,
	type UnityBridgeStatus,
	type UnitySelectionEntry,
	withUnityBridge,
} from "@thinkrail/unity-project";

export const UNITY_SELECTION_SECTION = "unity-editor-selection";

const SELECTION_READ_TIMEOUT_MS = 2_000;
const MAX_SELECTION_ENTRIES = 5;

type SelectionStatus = Pick<UnityBridgeStatus, "activeScene" | "selection">;

function formatEntry(entry: UnitySelectionEntry, activeScene: string | null): string {
	const kind = entry.type === "GameObject" ? "hierarchy path" : "path";
	const scene = entry.type === "GameObject" && activeScene ? ` in scene "${activeScene}"` : "";
	return `- "${entry.name}" (${entry.type}) at ${kind} "${entry.path}"${scene}`;
}

/** The system-prompt section describing the Editor's selection, or null when nothing is inspectable. */
export function unitySelectionSection(status: SelectionStatus | null): string | null {
	if (!status) return null;
	const entries = status.selection
		.filter((entry) => entry.path.length > 0)
		.slice(0, MAX_SELECTION_ENTRIES);
	if (entries.length === 0) return null;
	return [
		"The user's current Unity Editor selection:",
		...entries.map((entry) => formatEntry(entry, status.activeScene)),
		"Read it again with unity_status; call unity_inspect with a hierarchy path for components and property values.",
	].join("\n");
}

async function readUnityStatus(cwd: string): Promise<UnityBridgeStatus | null> {
	const root = findUnityProjectRoot(cwd);
	if (!root) return null;
	return withUnityBridge(root, (client) => client.status(), {
		requestTimeoutMs: SELECTION_READ_TIMEOUT_MS,
	});
}

/**
 * Adds the Editor's selection to the system prompt of every run, so the agent knows what the user is
 * looking at without it becoming a chat message. Never blocks a turn: a closed or busy Editor means no
 * section, not an error.
 */
export function registerUnityContext(
	pi: ExtensionAPI,
	readStatus: (cwd: string) => Promise<UnityBridgeStatus | null> = readUnityStatus,
): void {
	pi.on("before_agent_start", async (event) => {
		let status: UnityBridgeStatus | null = null;
		try {
			status = await readStatus(event.systemPromptOptions.cwd);
		} catch {
			status = null;
		}
		const section = unitySelectionSection(status);
		if (section) event.systemPromptOptions.sections[UNITY_SELECTION_SECTION] = section;
		else delete event.systemPromptOptions.sections[UNITY_SELECTION_SECTION];
	});
}
