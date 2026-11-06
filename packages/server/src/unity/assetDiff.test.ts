import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@thinkrail/contracts";
import { saveWorkspaces } from "../persistence";
import { unityAssetDiff } from "./assetDiff";

const WS_ID = "ws-unity-asset-diff";

const BASE = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_Name: Player
  m_Component:
  - component: {fileID: 400}
--- !u!4 &400
Transform:
  m_GameObject: {fileID: 100}
  m_LocalPosition: {x: 0, y: 1, z: 0}
  m_Father: {fileID: 0}
`;

let dataDir: string;
let projectRoot: string;

function workspaceRow(worktreePath: string): Workspace {
	return {
		id: WS_ID,
		projectId: "p1",
		name: "unity",
		branch: "main",
		baseBranch: "main",
		worktreePath,
		createdAt: 0,
	} as Workspace;
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "unity-diff-data-"));
	projectRoot = mkdtempSync(join(tmpdir(), "unity-diff-project-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	mkdirSync(join(projectRoot, "ProjectSettings"), { recursive: true });
	writeFileSync(
		join(projectRoot, "ProjectSettings", "ProjectVersion.txt"),
		"m_EditorVersion: 6000.0.0f1\n",
	);
	mkdirSync(join(projectRoot, "Assets"), { recursive: true });
	saveWorkspaces([workspaceRow(projectRoot)]);
});

afterEach(() => {
	delete process.env.THINKRAIL_DATA_DIR;
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(projectRoot, { recursive: true, force: true });
});

test("a prefab diff is object-level: names, transform paths and field edits", () => {
	const modified = BASE.replace("{x: 0, y: 1, z: 0}", "{x: 0, y: 4, z: 0}");
	const diff = unityAssetDiff(WS_ID, "Assets/Player.prefab", BASE, modified);
	expect(diff?.kind).toBe("prefab");
	expect(diff?.changed).toHaveLength(1);
	expect(diff?.changed[0]?.object).toMatchObject({
		fileId: "400",
		type: "Transform",
		name: "Player",
		path: "Player",
	});
	expect(diff?.changed[0]?.fields).toEqual([
		{ field: "m_LocalPosition.y", before: "1", after: "4" },
	]);
});

test("adding a GameObject is reported as a new object, not a line range", () => {
	const added = `${BASE}--- !u!1 &200
GameObject:
  m_Name: Weapon
`;
	const diff = unityAssetDiff(WS_ID, "Assets/Player.prefab", BASE, added);
	expect(diff?.added.map((object) => object.name)).toEqual(["Weapon"]);
	expect(diff?.removed).toEqual([]);
	expect(diff?.changed).toEqual([]);
});

test("non-Unity paths and projects without a project root yield no semantic diff", () => {
	expect(unityAssetDiff(WS_ID, "Assets/Player.cs", BASE, BASE)).toBeNull();
	rmSync(join(projectRoot, "ProjectSettings"), { recursive: true, force: true });
	expect(unityAssetDiff(WS_ID, "Assets/Player.prefab", BASE, BASE)).toBeNull();
});
