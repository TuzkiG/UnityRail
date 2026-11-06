import { expect, test } from "bun:test";
import { diffUnityObjectModels } from "./diff";
import { buildUnityObjectModel } from "./model";
import { parseUnityYaml } from "./yaml";

const PREFAB = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_ObjectHideFlags: 0
  m_Name: Player
  m_Component:
  - component: {fileID: 400}
  - component: {fileID: 11400000}
--- !u!4 &400
Transform:
  m_GameObject: {fileID: 100}
  m_LocalPosition: {x: 0, y: 1.5, z: 0}
  m_Father: {fileID: 0}
  m_Children:
  - {fileID: 401}
--- !u!114 &11400000
MonoBehaviour:
  m_GameObject: {fileID: 100}
  m_Script: {fileID: 11500000, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, type: 3}
  speed: 4
--- !u!1 &200
GameObject:
  m_Name: Weapon
--- !u!4 &401
Transform:
  m_GameObject: {fileID: 200}
  m_LocalPosition: {x: 0, y: 0, z: 1}
  m_Father: {fileID: 400}
`;

function model(prefab: string) {
	return buildUnityObjectModel(prefab, {
		resolveGuid: (guid) =>
			guid === "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ? "Assets/Scripts/PlayerController.cs" : null,
	});
}

test("a prefab's objects carry GameObject names, transform paths and resolved scripts", () => {
	const built = model(PREFAB);
	const player = built.objects.find((object) => object.fileId === "100");
	expect(player).toMatchObject({ type: "GameObject", name: "Player", path: "Player" });
	const weapon = built.objects.find((object) => object.fileId === "200");
	expect(weapon).toMatchObject({ name: "Weapon", path: "Player/Weapon" });
	const script = built.objects.find((object) => object.fileId === "11400000");
	expect(script).toMatchObject({ type: "PlayerController", name: "Player", path: "Player" });
	expect(script?.fields.find((field) => field.path === "m_Script")?.value).toBe(
		"Assets/Scripts/PlayerController.cs (fileID 11500000)",
	);
	expect(script?.fields.find((field) => field.path === "m_GameObject")?.value).toBe("fileID 100");
});

test("the diff tracks objects by fileID and reports field-level edits", () => {
	const before = model(PREFAB);
	const edited = PREFAB.replace(
		"m_LocalPosition: {x: 0, y: 1.5, z: 0}",
		"m_LocalPosition: {x: 0, y: 3, z: 0}",
	).replace("  speed: 4", "  speed: 9");
	const after = model(edited);
	const diff = diffUnityObjectModels("prefab", before, after);
	expect(diff.added).toEqual([]);
	expect(diff.removed).toEqual([]);
	expect(diff.changed).toHaveLength(2);
	const transform = diff.changed.find((change) => change.object.fileId === "400");
	expect(transform?.object.path).toBe("Player");
	expect(transform?.fields).toEqual([{ field: "m_LocalPosition.y", before: "1.5", after: "3" }]);
	const script = diff.changed.find((change) => change.object.fileId === "11400000");
	expect(script?.object.type).toBe("PlayerController");
	expect(script?.fields).toEqual([{ field: "speed", before: "4", after: "9" }]);
});

test("adding and removing an object is reported with its source line", () => {
	const before = model(PREFAB);
	const after = model(PREFAB.replace("  m_Name: Weapon", "  m_Name: Sword"));
	const diff = diffUnityObjectModels("prefab", before, after);
	expect(diff.added).toEqual([]);
	expect(diff.removed).toEqual([]);
	expect(diff.changed.map((change) => change.object.fileId)).toEqual(["200"]);

	const withoutWeapon = PREFAB.split("--- !u!1 &200")[0] ?? "";
	const removed = diffUnityObjectModels("prefab", before, model(withoutWeapon));
	expect(removed.removed.map((object) => object.fileId)).toEqual(["200", "401"]);
	expect(removed.removed[0]?.line).toBeGreaterThan(0);
});

test("unknown classes keep their fields instead of going blind", () => {
	const text = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!99999 &5
SomeFutureComponent:
  m_Name: Future
  m_Value: 1
`;
	const built = model(text);
	expect(built.objects[0]).toMatchObject({ type: "Class 99999", name: "Future" });
	expect(built.objects[0]?.fields.map((field) => field.path)).toEqual(["m_Name", "m_Value"]);
});

test("parseUnityYaml reports one document per Unity object and tolerates a truncated file", () => {
	const parsed = parseUnityYaml(PREFAB);
	expect(parsed.documents.map((document) => document.fileId)).toEqual([
		"100",
		"400",
		"11400000",
		"200",
		"401",
	]);
	expect(parsed.documents[0]?.classId).toBe(1);
	expect(parseUnityYaml("").documents).toEqual([]);
	expect(parseUnityYaml("not: unity-yaml").documents).toEqual([]);
});
