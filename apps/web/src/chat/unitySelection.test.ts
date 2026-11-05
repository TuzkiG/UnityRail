import { expect, test } from "bun:test";
import type { UnityStatusSnapshot } from "@thinkrail/contracts";
import { sameUnitySelection, unitySelectionOf } from "./unitySelection";

const status = (selection: UnityStatusSnapshot["bridge"]): UnityStatusSnapshot => ({
	isUnityProject: true,
	bridge: selection,
});

const bridge = (
	selection: Array<{ name: string; path: string; type: string }>,
	activeScene = "Assets/Scenes/Main.unity",
): NonNullable<UnityStatusSnapshot["bridge"]> => ({
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
	activeScene,
	selection: selection.map((entry, index) => ({ ...entry, instanceId: index })),
	lastCompile: null,
	consoleSeq: 0,
});

test("a selected GameObject carries its hierarchy scene", () => {
	expect(
		unitySelectionOf(status(bridge([{ name: "Player", path: "Root/Player", type: "GameObject" }]))),
	).toEqual({
		name: "Player",
		path: "Root/Player",
		type: "GameObject",
		scene: "Assets/Scenes/Main.unity",
	});
});

test("an asset selection shows its type without a scene", () => {
	expect(
		unitySelectionOf(
			status(bridge([{ name: "Steel", path: "Assets/Materials/Steel.mat", type: "Material" }])),
		),
	).toEqual({ name: "Steel", path: "Assets/Materials/Steel.mat", type: "Material", scene: null });
});

test("the first selection entry with a path wins", () => {
	expect(
		unitySelectionOf(
			status(
				bridge([
					{ name: "Component", path: "", type: "BoxCollider" },
					{ name: "Player", path: "Root/Player", type: "GameObject" },
				]),
			),
		)?.name,
	).toBe("Player");
});

test("no bridge or no selection has no chip", () => {
	expect(unitySelectionOf({ isUnityProject: true, bridge: null })).toBeNull();
	expect(unitySelectionOf(status(bridge([])))).toBeNull();
});

test("a repoll with the same selection keeps the previous chip identity", () => {
	const selection = { name: "Player", path: "Root/Player", type: "GameObject", scene: "Main" };
	expect(sameUnitySelection(selection, { ...selection })).toBe(true);
	expect(sameUnitySelection(selection, { ...selection, path: "Root/Other" })).toBe(false);
	expect(sameUnitySelection(null, null)).toBe(true);
	expect(sameUnitySelection(selection, null)).toBe(false);
});
