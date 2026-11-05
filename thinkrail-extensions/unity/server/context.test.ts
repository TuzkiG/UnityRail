import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { UnityBridgeStatus, UnitySelectionEntry } from "@thinkrail/unity-project";
import { registerUnityContext, UNITY_SELECTION_SECTION, unitySelectionSection } from "./context";

interface CapturedEvent {
	systemPromptOptions: { cwd: string; sections: Record<string, string> };
}

type Handler = (event: CapturedEvent) => Promise<void> | void;

function capture(readStatus: () => Promise<UnityBridgeStatus | null>): Handler {
	let handler: Handler | undefined;
	const pi = {
		on: (event: string, next: Handler) => {
			if (event === "before_agent_start") handler = next;
		},
	} as unknown as ExtensionAPI;
	registerUnityContext(pi, readStatus);
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
