import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	UnityBridgeStatus,
	UnityEditorTool,
	UnitySelectionEntry,
} from "@thinkrail/unity-project";
import {
	registerUnityContext,
	UNITY_SELECTION_SECTION,
	UNITY_TOOLS_SECTION,
	unitySelectionSection,
	unityToolsSection,
} from "./context";

interface CapturedEvent {
	systemPromptOptions: { cwd: string; sections: Record<string, string> };
}

type Handler = (event: CapturedEvent) => Promise<void> | void;

function capture(
	readStatus: () => Promise<UnityBridgeStatus | null>,
	readTools: () => Promise<UnityEditorTool[] | null> = async () => null,
): Handler {
	let handler: Handler | undefined;
	const pi = {
		on: (event: string, next: Handler) => {
			if (event === "before_agent_start") handler = next;
		},
	} as unknown as ExtensionAPI;
	registerUnityContext(pi, readStatus, readTools);
	if (!handler) throw new Error("before_agent_start was not registered");
	return handler;
}

function statusWith(selection: Array<Partial<UnitySelectionEntry>>): UnityBridgeStatus {
	return {
		protocolVersion: 1,
		port: 1,
		projectPath: "/project",
		unityVersion: "2022.3.62f3",
		bridgeStartedAt: "2026-01-01T00:00:00Z",
		isPlaying: false,
		isPaused: false,
		isCompiling: false,
		isUpdating: false,
		applicationPath: "",
		platform: "WindowsEditor",
		activeScene: "Assets/Scenes/Main.unity",
		selection: selection.map((entry, index) => ({
			name: "Player",
			path: "Root/Player",
			type: "GameObject",
			instanceId: index,
			...entry,
		})),
		lastCompile: null,
		consoleSeq: 0,
	};
}

function event(): CapturedEvent {
	return { systemPromptOptions: { cwd: "/project", sections: {} } };
}

describe("the Unity Editor selection context", () => {
	test("a selected GameObject becomes a system-prompt section with its scene", async () => {
		const handler = capture(async () => statusWith([{ name: "Player", path: "Root/Player" }]));
		const started = event();
		await handler(started);
		const section = started.systemPromptOptions.sections[UNITY_SELECTION_SECTION];
		expect(section).toContain('"Player" (GameObject) at hierarchy path "Root/Player"');
		expect(section).toContain('in scene "Assets/Scenes/Main.unity"');
		expect(section).toContain("unity_inspect");
	});

	test("an asset selection is reported by path without a scene", async () => {
		const handler = capture(async () =>
			statusWith([{ name: "Steel", type: "Material", path: "Assets/Materials/Steel.mat" }]),
		);
		const started = event();
		await handler(started);
		const section = started.systemPromptOptions.sections[UNITY_SELECTION_SECTION] ?? "";
		expect(section).toContain('"Steel" (Material) at path "Assets/Materials/Steel.mat"');
		expect(section).not.toContain("Assets/Scenes/Main.unity");
	});

	test("no selection or a failed read leaves the turn without the section", async () => {
		for (const read of [
			async () => null,
			async () => statusWith([]),
			async () => {
				throw new Error("bridge closed");
			},
		]) {
			const started = event();
			started.systemPromptOptions.sections[UNITY_SELECTION_SECTION] = "stale";
			await capture(read)(started);
			expect(started.systemPromptOptions.sections[UNITY_SELECTION_SECTION]).toBeUndefined();
		}
	});
});

describe("the project Editor tool context", () => {
	test("the project's [BridgeTool] tools become a system-prompt section", async () => {
		const handler = capture(
			async () => null,
			async () => [{ name: "bake_tiles", description: "Bake the tilemap.\nRuns in the Editor." }],
		);
		const started = event();
		await handler(started);
		const section = started.systemPromptOptions.sections[UNITY_TOOLS_SECTION] ?? "";
		expect(section).toContain("- bake_tiles — Bake the tilemap. Runs in the Editor.");
		expect(section).toContain("unity_editor_tool { name, parameters }");
	});

	test("no tools, a closed Editor or a throw removes the section", async () => {
		for (const readTools of [
			async () => null,
			async () => [],
			async () => {
				throw new Error("bridge closed");
			},
		] as Array<() => Promise<UnityEditorTool[] | null>>) {
			const started = event();
			started.systemPromptOptions.sections[UNITY_TOOLS_SECTION] = "stale";
			await capture(async () => null, readTools)(started);
			expect(started.systemPromptOptions.sections[UNITY_TOOLS_SECTION]).toBeUndefined();
		}
	});
});

describe("unityToolsSection", () => {
	test("caps the list and points at the full one", () => {
		const tools = Array.from({ length: 20 }, (_, index) => ({
			name: `tool_${index}`,
			description: "y".repeat(300),
		}));
		const section = unityToolsSection(tools) ?? "";
		expect(section.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(12);
		expect(section).toContain("… and 8 more");
		expect(section).not.toContain("tool_19");
	});

	test("null or empty tools have no section", () => {
		expect(unityToolsSection(null)).toBeNull();
		expect(unityToolsSection([])).toBeNull();
	});
});

describe("unitySelectionSection", () => {
	test("skips entries without a path and caps the list", () => {
		const section = unitySelectionSection(
			statusWith([
				{ name: "NoPath", path: "" },
				...Array.from({ length: 8 }, (_, index) => ({
					name: `Item${index}`,
					path: `Root/Item${index}`,
				})),
			]),
		);
		expect(section?.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(5);
		expect(section).not.toContain("NoPath");
	});

	test("null status has no section", () => {
		expect(unitySelectionSection(null)).toBeNull();
	});
});
