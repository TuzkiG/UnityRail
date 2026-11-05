import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@thinkrail/contracts";
import { removeDirectoryLink } from "@thinkrail/unity-project";
import { saveWorkspaces } from "../persistence";
import { unityLinkModule, unityProjectConfig, unityUnlinkModule } from "./service";

const WS_ID = "ws-unity-link-test";

let dataDir: string;
let projectRoot: string;
let businessRoot: string;

function writeUnityMarker(root: string): void {
	mkdirSync(join(root, "ProjectSettings"), { recursive: true });
	writeFileSync(
		join(root, "ProjectSettings", "ProjectVersion.txt"),
		"m_EditorVersion: 6000.0.0f1\n",
	);
	mkdirSync(join(root, "Assets"), { recursive: true });
}

function moduleAt(name: string): { mountPath?: string; path: string } | undefined {
	return unityProjectConfig(WS_ID).modules.find((module) => module.name === name);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "unity-data-"));
	projectRoot = mkdtempSync(join(tmpdir(), "unity-project-"));
	businessRoot = mkdtempSync(join(tmpdir(), "unity-business-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	writeUnityMarker(projectRoot);
	mkdirSync(join(businessRoot, "FeatureBigWatermelon"), { recursive: true });
	const ws = {
		id: WS_ID,
		projectId: "p1",
		name: "unity",
		branch: "main",
		baseBranch: "main",
		worktreePath: projectRoot,
		createdAt: 0,
	} as Workspace;
	saveWorkspaces([ws]);
});

afterEach(() => {
	delete process.env.THINKRAIL_DATA_DIR;
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(projectRoot, { recursive: true, force: true });
	rmSync(businessRoot, { recursive: true, force: true });
});

test("linking a business folder mounts Assets/Game and records the module", () => {
	const source = join(businessRoot, "FeatureBigWatermelon");
	const config = unityLinkModule(WS_ID, "Game", source);
	const module = config.modules.find((entry) => entry.name === "Game");
	expect(module?.mountPath).toBe(join(projectRoot, "Assets", "Game"));
	expect(module?.path).toBe(source);
	expect(readlinkSync(join(projectRoot, "Assets", "Game"))).toBe(source);
});

test("re-linking the same source is idempotent and keeps a single module row", () => {
	const source = join(businessRoot, "FeatureBigWatermelon");
	unityLinkModule(WS_ID, "Game", source);
	unityLinkModule(WS_ID, "Game", source);
	expect(unityProjectConfig(WS_ID).modules.filter((entry) => entry.name === "Game")).toHaveLength(
		1,
	);
});

test("re-linking a different source retargets the existing mount instead of creating a parallel one", () => {
	const first = join(businessRoot, "FeatureBigWatermelon");
	mkdirSync(join(businessRoot, "FeatureBigWatermelon2"));
	const second = join(businessRoot, "FeatureBigWatermelon2");
	unityLinkModule(WS_ID, "Game", first);
	unityLinkModule(WS_ID, "Game", second);
	expect(readlinkSync(join(projectRoot, "Assets", "Game"))).toBe(second);
	expect(unityProjectConfig(WS_ID).modules.map((entry) => entry.path)).toEqual([second]);
});

test("a real directory at the mount path is never replaced", () => {
	mkdirSync(join(projectRoot, "Assets", "Game"), { recursive: true });
	expect(() => unityLinkModule(WS_ID, "Game", businessRoot)).toThrow(
		/UNITY_LINK_EXISTS|already exists/,
	);
	expect(moduleAt("Game")).toBeUndefined();
});

test("a dangling mount is healed instead of blocking every future link", () => {
	const gone = join(businessRoot, "gone");
	mkdirSync(gone);
	unityLinkModule(WS_ID, "Game", gone);
	rmSync(gone, { recursive: true, force: true });
	const source = join(businessRoot, "FeatureBigWatermelon");
	unityLinkModule(WS_ID, "Game", source);
	expect(readlinkSync(join(projectRoot, "Assets", "Game"))).toBe(source);
});

test("unlinking removes the mount and the record but leaves the external folder intact", () => {
	const source = join(businessRoot, "FeatureBigWatermelon");
	writeFileSync(join(source, "keep.txt"), "keep\n");
	unityLinkModule(WS_ID, "Game", source);
	const config = unityUnlinkModule(WS_ID, source);
	expect(config.modules).toEqual([]);
	expect(readFileSync(join(source, "keep.txt"), "utf8")).toBe("keep\n");
	expect(() => readFileSync(join(projectRoot, "Assets", "Game", "keep.txt"))).toThrow();
});

test("unlinking a bare project mount never deletes a real project folder", () => {
	const real = join(projectRoot, "Assets", "Scenes");
	mkdirSync(real);
	writeFileSync(join(real, "main.unity"), "scene\n");
	unityUnlinkModule(WS_ID, real);
	expect(readFileSync(join(real, "main.unity"), "utf8")).toBe("scene\n");
	expect(removeDirectoryLink(real)).toBe(false);
});
