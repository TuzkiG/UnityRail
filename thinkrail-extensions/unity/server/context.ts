import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	findUnityProjectRoot,
	type UnityBridgeStatus,
	type UnityEditorTool,
	type UnitySelectionEntry,
	withUnityBridge,
} from "@thinkrail/unity-project";

export const UNITY_SELECTION_SECTION = "unity-editor-selection";
export const UNITY_TOOLS_SECTION = "unity-editor-tools";

const SELECTION_READ_TIMEOUT_MS = 2_000;
const MAX_SELECTION_ENTRIES = 5;
const MAX_INJECTED_TOOLS = 12;
const MAX_INJECTED_DESCRIPTION_CHARS = 120;

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

async function readUnityTools(cwd: string): Promise<UnityEditorTool[] | null> {
	const root = findUnityProjectRoot(cwd);
	if (!root) return null;
	return withUnityBridge(root, (client) => client.listEditorTools(), {
		requestTimeoutMs: SELECTION_READ_TIMEOUT_MS,
	});
}

/**
 * The system-prompt section naming the project's own `[BridgeTool]` methods, or null when it has none.
 * The agent only knows they exist because the Editor told it, and stale names are worse than none.
 */
export function unityToolsSection(tools: readonly UnityEditorTool[] | null): string | null {
	if (!tools || tools.length === 0) return null;
	const shown = tools.slice(0, MAX_INJECTED_TOOLS);
	const lines = [
		"This Unity project registers its own Editor tools. Call one with unity_editor_tool { name, parameters }:",
	];
	for (const tool of shown) {
		const description = tool.description.replace(/\s+/g, " ").trim();
		const text =
			description.length > MAX_INJECTED_DESCRIPTION_CHARS
				? `${description.slice(0, MAX_INJECTED_DESCRIPTION_CHARS)}…`
				: description;
		lines.push(`- ${tool.name}${text ? ` — ${text}` : ""}`);
	}
	if (tools.length > shown.length) {
		lines.push(
			`… and ${tools.length - shown.length} more; unity_editor_tool without a name lists all of them.`,
		);
	}
	return lines.join("\n");
}

/**
 * Adds the Editor's selection and the project's own Editor tools to the system prompt of every run, so
 * the agent knows what the user is looking at without it becoming a chat message. Never blocks a turn:
 * a closed or busy Editor means no section, not an error.
 */
export function registerUnityContext(
	pi: ExtensionAPI,
	readStatus: (cwd: string) => Promise<UnityBridgeStatus | null> = readUnityStatus,
	readTools: (cwd: string) => Promise<UnityEditorTool[] | null> = readUnityTools,
): void {
	pi.on("before_agent_start", async (event) => {
		const cwd = event.systemPromptOptions.cwd;
		const [status, tools] = await Promise.all([
			readStatus(cwd).catch(() => null),
			readTools(cwd).catch(() => null),
		]);
		const selection = unitySelectionSection(status);
		if (selection) event.systemPromptOptions.sections[UNITY_SELECTION_SECTION] = selection;
		else delete event.systemPromptOptions.sections[UNITY_SELECTION_SECTION];
		const catalog = unityToolsSection(tools);
		if (catalog) event.systemPromptOptions.sections[UNITY_TOOLS_SECTION] = catalog;
		else delete event.systemPromptOptions.sections[UNITY_TOOLS_SECTION];
	});
}
