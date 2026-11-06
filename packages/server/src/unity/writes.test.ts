import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@thinkrail/contracts";
import { saveWorkspaces } from "../persistence";
import {
	unityChangePackage,
	unityDeleteObject,
	unityExecuteMenu,
	unityQuitEditor,
	unityRemoveComponent,
	unityStartBuild,
	unityWriteSettings,
} from "./service";

const WS = "ws-write-guard";

let dataDir: string;
let worktree: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "unity-writes-"));
	worktree = mkdtempSync(join(tmpdir(), "unity-writes-wt-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	const workspace = {
		id: WS,
		projectId: "p1",
		name: "plain folder",
		branch: "main",
		baseBranch: "main",
		worktreePath: worktree,
		createdAt: 0,
	} as Workspace;
	saveWorkspaces([workspace]);
});

afterEach(() => {
	delete process.env.THINKRAIL_DATA_DIR;
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(worktree, { recursive: true, force: true });
});

const CONFIRM = { code: "UNITY_CONFIRM_REQUIRED" };

test("destructive scene edits refuse to run without an explicit confirmation", async () => {
	await expect(unityDeleteObject(WS, { path: "Player" })).rejects.toMatchObject(CONFIRM);
	await expect(
		unityRemoveComponent(WS, { path: "Player", component: "BoxCollider" }),
	).rejects.toMatchObject(CONFIRM);
});

test("global actions refuse to run without an explicit confirmation", async () => {
	await expect(unityExecuteMenu(WS, "Assets/Refresh", false)).rejects.toMatchObject(CONFIRM);
	await expect(unityStartBuild(WS, { target: "windows" }, false)).rejects.toMatchObject(CONFIRM);
	await expect(
		unityChangePackage(WS, "add", "com.unity.inputsystem", false),
	).rejects.toMatchObject(CONFIRM);
	await expect(unityWriteSettings(WS, { productName: "Game" }, false)).rejects.toMatchObject(
		CONFIRM,
	);
	await expect(unityQuitEditor(WS, {}, false)).rejects.toMatchObject(CONFIRM);
});

test("a confirmed action still refuses a workspace without a Unity project", async () => {
	await expect(unityExecuteMenu(WS, "Assets/Refresh", true)).rejects.toMatchObject({
		code: "UNITY_NOT_PROJECT",
	});
});
