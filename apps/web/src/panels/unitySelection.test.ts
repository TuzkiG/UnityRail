import { expect, test } from "bun:test";
import type { UnitySelectionEntry } from "@thinkrail/contracts";
import { editorSelectionPath } from "./unitySelection";

const selectionEntry = (overrides: Partial<UnitySelectionEntry> = {}): UnitySelectionEntry => ({
	name: "Player",
	path: "Player",
	type: "GameObject",
	instanceId: 1,
	...overrides,
});

test("the first selected GameObject is the inspected path", () => {
	expect(
		editorSelectionPath([
			selectionEntry({ path: "" }),
			selectionEntry({ path: "Root/Player" }),
			selectionEntry({ path: "Root/Enemy" }),
		]),
	).toBe("Root/Player");
});

test("a selection that is not a scene GameObject has no path to inspect", () => {
	expect(
		editorSelectionPath([
			selectionEntry({ type: "Material", path: "Assets/Materials/Steel.mat" }),
			selectionEntry({ type: "BoxCollider", path: "" }),
		]),
	).toBeNull();
});

test("an empty or missing selection has no path", () => {
	expect(editorSelectionPath([])).toBeNull();
	expect(editorSelectionPath(undefined)).toBeNull();
});
