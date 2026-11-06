import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type UnityEditorTool, withUnityBridge } from "@thinkrail/unity-project";
import { Type } from "typebox";
import { errorMessage, errorResult, textResult, unityProjectRoot } from "./shared.ts";

/** How many project tools a list result spells out before it summarizes the rest. */
const MAX_LISTED_TOOLS = 40;
const MAX_DESCRIPTION_CHARS = 240;

const editorToolParams = Type.Object({
	name: Type.Optional(
		Type.String({
			description:
				"Name of a project Editor tool. Omit it to list the tools this project registers.",
		}),
	),
	parameters: Type.Optional(
		Type.Unsafe<Record<string, unknown>>({
			type: "object",
			additionalProperties: true,
			description:
				"Arguments for the tool, as a JSON object. The tool's parameter documentation says which keys it reads.",
		}),
	),
});

/** The list the agent reads before it picks a tool. */
export function formatEditorTools(tools: readonly UnityEditorTool[]): string {
	if (tools.length === 0) {
		return 'This project registers no Editor tools. A static C# method marked [BridgeTool("name", "description")] in an Editor assembly becomes callable through unity_editor_tool.';
	}
	const shown = tools.slice(0, MAX_LISTED_TOOLS);
	const lines = [`${tools.length} project Editor tool${tools.length === 1 ? "" : "s"} registered:`];
	for (const tool of shown) {
		const description = tool.description.trim();
		const text =
			description.length > MAX_DESCRIPTION_CHARS
				? `${description.slice(0, MAX_DESCRIPTION_CHARS)}…`
				: description;
		lines.push(`- ${tool.name}${text ? ` — ${text}` : ""}`);
		if (tool.parameters) lines.push(`  parameters: ${tool.parameters}`);
	}
	if (tools.length > shown.length) lines.push(`… and ${tools.length - shown.length} more.`);
	lines.push("Call one with unity_editor_tool { name, parameters }.");
	return lines.join("\n");
}

/** The result of one project tool, as text the model can read. */
export function formatEditorToolResult(name: string, result: unknown): string {
	if (result === undefined || result === null) return `${name} returned nothing.`;
	if (typeof result === "string") return `${name}: ${result}`;
	return `${name}: ${JSON.stringify(result, null, 2)}`;
}

/**
 * The bridge's `[BridgeTool]` methods live in the project's own C# code, so the only way to know they
 * exist is to ask the Editor. One meta-tool keeps a project's tools out of the tool table itself.
 */
export function registerUnityEditorTools(pi: ExtensionAPI): void {
	pi.registerTool<typeof editorToolParams, Record<string, unknown>>({
		name: "unity_editor_tool",
		label: "Unity Editor Tool",
		description:
			"List and call the Editor tools this project registers in its own C# code with [BridgeTool]. Call it with no name to see what the project exposes (folder/scene/asset generators, importers, validators, bake steps), then again with a name and parameters to run one. These tools run inside the Editor, so read unity_status first if the result depends on the open scene, and run unity_compile / unity_console afterwards when a tool changes the project.",
		promptSnippet:
			"unity_editor_tool — list or call the Editor tools this project registers with [BridgeTool].",
		parameters: editorToolParams,
		async execute(_callId, params, signal, _onUpdate, ctx) {
			const root = unityProjectRoot(ctx.cwd);
			const bridgeOptions = signal ? { signal } : {};
			const name = params.name?.trim();
			try {
				if (!name) {
					const tools = await withUnityBridge(
						root,
						(client) => client.listEditorTools(signal),
						bridgeOptions,
					);
					return textResult(formatEditorTools(tools), { mode: "list", tools });
				}
				const invocation = await withUnityBridge(
					root,
					(client) => client.invokeEditorTool(name, params.parameters ?? {}, signal),
					bridgeOptions,
				);
				return textResult(formatEditorToolResult(name, invocation.result), {
					mode: "invoke",
					name,
					result: invocation.result,
				});
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});
}
