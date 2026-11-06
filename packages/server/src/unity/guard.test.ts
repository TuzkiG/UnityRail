import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@thinkrail/contracts";
import { clearUnityProjectCaches } from "@thinkrail/unity-project";
import { saveWorkspaces } from "../persistence";
import { unityAssetGuard } from "./guard";

const WS_ID = "ws-unity-guard";

let dataDir: string;
let projectRoot: string;

function write(path: string, content: string | Buffer): void {
	mkdirSync(join(projectRoot, path, ".."), { recursive: true });
	writeFileSync(join(projectRoot, path), content);
}

function meta(guid: string): string {
	return `fileFormatVersion: 2\nguid: ${guid}\n`;
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "unity-guard-data-"));
	projectRoot = mkdtempSync(join(tmpdir(), "unity-guard-project-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	clearUnityProjectCaches();
	mkdirSync(join(projectRoot, "ProjectSettings"), { recursive: true });
	writeFileSync(
		join(projectRoot, "ProjectSettings", "ProjectVersion.txt"),
		"m_EditorVersion: 6000.0.0f1\n",
	);
	mkdirSync(join(projectRoot, "Assets"), { recursive: true });
	writeFileSync(join(projectRoot, ".gitignore"), "Library/\nTemp/\n");
	writeFileSync(
		join(projectRoot, ".gitattributes"),
		"*.unity merge=unityyamlmerge eol=lf\n*.prefab merge=unityyamlmerge eol=lf\n",
	);
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
	clearUnityProjectCaches();
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(projectRoot, { recursive: true, force: true });
});

test("a clean change set reports nothing beyond the project-wide checks", () => {
	write("Assets/Player.prefab", "%YAML 1.1\n");
	write("Assets/Player.prefab.meta", meta("0123456789abcdef0123456789abcdef"));
	const report = unityAssetGuard(WS_ID, ["Assets/Player.prefab"]);
	expect(report.findings).toEqual([]);
	expect(report.checkedPaths).toBe(1);
});

test("an asset without its .meta is an error; a .meta without its asset is a warning", () => {
	write("Assets/Enemy.prefab", "%YAML 1.1\n");
	write("Assets/Ghost.prefab.meta", meta("ffffffffffffffffffffffffffffffff"));
	const report = unityAssetGuard(WS_ID, ["Assets/Enemy.prefab", "Assets/Ghost.prefab.meta"]);
	const codes = report.findings.map((finding) => finding.code);
	expect(codes).toContain("MISSING_META");
	expect(codes).toContain("ORPHAN_META");
	expect(report.findings.find((finding) => finding.code === "MISSING_META")?.severity).toBe(
		"error",
	);
});

test("a duplicated GUID is reported against the other asset that owns it", () => {
	const guid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
	write("Assets/One.prefab", "%YAML 1.1\n");
	write("Assets/One.prefab.meta", meta(guid));
	write("Assets/Two.prefab", "%YAML 1.1\n");
	write("Assets/Two.prefab.meta", meta(guid));
	clearUnityProjectCaches();
	const report = unityAssetGuard(WS_ID, ["Assets/One.prefab.meta"]);
	const duplicate = report.findings.find((finding) => finding.code === "DUPLICATE_GUID");
	expect(duplicate?.detail).toContain("Assets/Two.prefab");
});

test("a large asset outside LFS is a warning, and an LFS rule silences it", () => {
	const big = Buffer.alloc(3 * 1024 * 1024, 1);
	write("Assets/Big.psd", big);
	write("Assets/Big.psd.meta", meta("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"));
	const before = unityAssetGuard(WS_ID, ["Assets/Big.psd"]);
	expect(before.findings.map((finding) => finding.code)).toContain("LARGE_ASSET");

	writeFileSync(
		join(projectRoot, ".gitattributes"),
		"Assets/** filter=lfs diff=lfs merge=lfs -text\n",
	);
	const after = unityAssetGuard(WS_ID, ["Assets/Big.psd"]);
	expect(after.findings.map((finding) => finding.code)).not.toContain("LARGE_ASSET");
});

test("a repository without the Unity merge driver or Library ignore is flagged", () => {
	rmSync(join(projectRoot, ".gitattributes"));
	rmSync(join(projectRoot, ".gitignore"));
	const report = unityAssetGuard(WS_ID, []);
	const codes = report.findings.map((finding) => finding.code);
	expect(codes).toContain("MERGE_DRIVER_MISSING");
	expect(codes).toContain("IGNORE_MISSING");
	expect(report.checkedPaths).toBe(0);
});

test("changes outside the Unity project are not inspected", () => {
	const report = unityAssetGuard(WS_ID, ["docs/readme.md"]);
	expect(report.findings).toEqual([]);
	expect(report.checkedPaths).toBe(0);
});
