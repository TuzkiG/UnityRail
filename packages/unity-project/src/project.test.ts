import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	buildAssemblyGraph,
	buildGuidIndex,
	clearUnityProjectCaches,
	findUnityProjectRoot,
	parseProjectVersion,
	readUnityProject,
	resolveGuid,
	sameProjectPath,
} from "./index.ts";
import { createUnityFixture, FIXTURE_GUIDS, writeBridgeFile } from "./test/fixture.ts";

const fixtures: Array<{ cleanup: () => void }> = [];

afterEach(() => {
	for (const fixture of fixtures.splice(0)) fixture.cleanup();
	clearUnityProjectCaches();
});

function fixture() {
	const created = createUnityFixture();
	fixtures.push(created);
	return created;
}

describe("Unity project model", () => {
	test("finds the project root from a nested workspace folder", () => {
		const created = fixture();
		const nested = join(created.root, "Assets", "Scripts");
		expect(findUnityProjectRoot(nested)).toBe(created.root);
		expect(findUnityProjectRoot(created.root)).toBe(created.root);
	});

	test("reads version, settings, packages, scenes, prefabs and counts", () => {
		const created = fixture();
		created.write(
			"Assets/Prefabs/Enemy.prefab",
			"%YAML 1.1\n--- !u!1 &1\nGameObject:\n  m_Name: Enemy\n",
		);
		const project = readUnityProject(created.root);
		expect(project.editorVersion).toBe("6000.0.23f1");
		expect(project.editorVersionWithRevision).toContain("1a2b3c4d5e6f");
		expect(project.productName).toBe("UnityFixture");
		expect(project.companyName).toBe("UnityRail");
		expect(project.packages.find((pkg) => pkg.name === "com.unity.modules.ui")?.builtin).toBe(true);
		expect(project.packages.find((pkg) => pkg.name === "com.unity.inputsystem")?.version).toBe(
			"1.11.2",
		);
		expect(project.scenes).toEqual([{ name: "Main", path: "Assets/Scenes/Main.unity" }]);
		expect(project.prefabs).toEqual([{ name: "Enemy", path: "Assets/Prefabs/Enemy.prefab" }]);
		expect(project.counts.scripts).toBe(2);
		expect(project.counts.assemblies).toBe(3);
		expect(project.bridge).toBeNull();
	});

	test("parses versions and tolerates revisions", () => {
		expect(parseProjectVersion("m_EditorVersion: 2022.3.62f1")).toEqual({
			version: "2022.3.62f1",
		});
		expect(
			parseProjectVersion(
				"m_EditorVersion: 6000.0.23f1\nm_EditorVersionWithRevision: 6000.0.23f1 (abc)",
			),
		).toEqual({
			version: "6000.0.23f1",
			withRevision: "6000.0.23f1 (abc)",
		});
	});

	test("builds the assembly graph and resolves GUID references", () => {
		const created = fixture();
		const project = readUnityProject(created.root);
		const graph = buildAssemblyGraph(project.asmdefs);
		const game = graph.byName.Game;
		const editor = graph.byName["Fixture.Editor"];
		expect(game?.resolvedReferences).toContain("Fixture.Shared");
		expect(editor?.resolvedReferences).toContain("Game");
		expect(editor?.editorOnly).toBe(true);
		expect(graph.cycles).toEqual([]);
	});

	test("reports missing references and cycles", () => {
		const created = fixture();
		created.write("Assets/Scripts/A.asmdef", JSON.stringify({ name: "A", references: ["B"] }));
		created.write(
			"Assets/Scripts/B.asmdef",
			JSON.stringify({ name: "B", references: ["A", "Missing"] }),
		);
		const project = readUnityProject(created.root);
		expect(project.assemblyGraph.cycles.length).toBe(1);
		expect(project.assemblyGraph.byName.B?.missingReferences).toEqual(["Missing"]);
		expect(project.warnings.some((warning) => warning.includes("cycle"))).toBe(true);
	});

	test("indexes asset GUIDs and resolves both directions", () => {
		const created = fixture();
		const index = buildGuidIndex(created.root);
		expect(index.byGuid.get(FIXTURE_GUIDS.mainScene)).toBe("Assets/Scenes/Main.unity");
		expect(index.byPath.get("Assets/Scripts/Game.cs")).toBe(FIXTURE_GUIDS.gameScript);
		expect(resolveGuid(created.root, FIXTURE_GUIDS.gameAsmdef)).toBe("Assets/Scripts/Game.asmdef");
	});

	test("reads a discovery file that starts with a UTF-8 BOM", () => {
		const created = fixture();
		const discovery = {
			protocolVersion: 1,
			port: 39_217,
			token: "0123456789abcdef0123456789abcdef",
			pid: process.pid,
			projectPath: created.root,
			unityVersion: "2022.3.62f3",
			startedAt: new Date().toISOString(),
		};
		// Unity writes with Encoding.UTF8, which prefixes the BOM.
		created.write("Library/ThinkRailBridge.json", `﻿${JSON.stringify(discovery, null, 2)}`);
		expect(readUnityProject(created.root).bridge?.port).toBe(39_217);
	});

	test("reads a local bridge discovery file", () => {
		const created = fixture();
		writeBridgeFile(join(created.root, "Library", "ThinkRailBridge.json"), {
			protocolVersion: 1,
			port: 39_217,
			token: "0123456789abcdef0123456789abcdef",
			pid: process.pid,
			projectPath: created.root,
			unityVersion: "6000.0.23f1",
			startedAt: new Date().toISOString(),
		});
		const project = readUnityProject(created.root);
		expect(project.bridge?.port).toBe(39_217);
		expect(project.bridge?.projectPath).toBe(created.root);
	});

	test("compares project paths case-insensitively on Windows", () => {
		expect(sameProjectPath("C:\\Work\\Game", "c:\\work\\game\\")).toBe(
			process.platform === "win32",
		);
	});
});
