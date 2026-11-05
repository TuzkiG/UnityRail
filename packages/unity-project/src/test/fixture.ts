import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { UnityBridgeDiscovery } from "../bridge/protocol.ts";

export interface UnityFixture {
	root: string;
	cleanup(): void;
	write(relativePath: string, content: string): void;
}

const MAIN_SCENE_GUID = "11111111111111111111111111111111";
const GAME_ASMDEF_GUID = "22222222222222222222222222222222";
const EDITOR_ASMDEF_GUID = "33333333333333333333333333333333";
const SHARED_ASMDEF_GUID = "55555555555555555555555555555555";
const GAME_SCRIPT_GUID = "44444444444444444444444444444444";

export function createUnityFixture(): UnityFixture {
	const root = mkdtempSync(join(tmpdir(), "unity-project-"));
	const write = (relativePath: string, content: string): void => {
		const absolute = join(root, relativePath);
		mkdirSync(dirname(absolute), { recursive: true });
		writeFileSync(absolute, content);
	};
	const meta = (guid: string) =>
		`fileFormatVersion: 2\nguid: ${guid}\nMonoImporter:\n  externalObjects: {}\n  serializedVersion: 2\n`;
	write(
		"ProjectSettings/ProjectVersion.txt",
		"m_EditorVersion: 6000.0.23f1\nm_EditorVersionWithRevision: 6000.0.23f1 (1a2b3c4d5e6f)\n",
	);
	write(
		"ProjectSettings/ProjectSettings.asset",
		"%YAML 1.1\n--- !u!129 &1\nPlayerSettings:\n  productName: UnityFixture\n  companyName: UnityRail\n",
	);
	write(
		"Packages/manifest.json",
		JSON.stringify(
			{
				dependencies: {
					"com.unity.modules.ui": "1.0.0",
					"com.unity.inputsystem": "1.11.2",
					"com.unity.test-framework": "1.4.5",
				},
			},
			null,
			2,
		),
	);
	write(
		"Packages/packages-lock.json",
		JSON.stringify(
			{
				dependencies: {
					"com.unity.inputsystem": { version: "1.11.2", source: "registry", depth: 0 },
				},
			},
			null,
			2,
		),
	);
	write("Assets/Scenes/Main.unity", "%YAML 1.1\n--- !u!1 &100\nGameObject:\n  m_Name: Main\n");
	write("Assets/Scenes/Main.unity.meta", meta(MAIN_SCENE_GUID));
	write(
		"Assets/Scripts/Game.asmdef",
		JSON.stringify(
			{
				name: "Game",
				rootNamespace: "Fixture",
				references: ["Unity.InputSystem", "GUID:55555555555555555555555555555555"],
				includePlatforms: [],
				excludePlatforms: [],
				defineConstraints: [],
				autoReferenced: true,
			},
			null,
			2,
		),
	);
	write("Assets/Scripts/Game.asmdef.meta", meta(GAME_ASMDEF_GUID));
	write("Assets/Shared/Shared.asmdef", JSON.stringify({ name: "Fixture.Shared", references: [] }));
	write("Assets/Shared/Shared.asmdef.meta", meta(SHARED_ASMDEF_GUID));
	write("Assets/Scripts/Game.cs", "public sealed class Game {}\n");
	write("Assets/Scripts/Game.cs.meta", meta(GAME_SCRIPT_GUID));
	write(
		"Assets/Editor/EditorTools.asmdef",
		JSON.stringify(
			{ name: "Fixture.Editor", references: ["Game"], includePlatforms: ["Editor"] },
			null,
			2,
		),
	);
	write("Assets/Editor/EditorTools.asmdef.meta", meta(EDITOR_ASMDEF_GUID));
	write("Assets/Editor/EditorTools.cs", "internal static class EditorTools {}\n");
	return {
		root,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
		write,
	};
}

export function writeBridgeDiscovery(
	fixture: UnityFixture,
	overrides: Partial<UnityBridgeDiscovery> = {},
): UnityBridgeDiscovery {
	writeBridgeFile(join(fixture.root, "Library", "ThinkRailBridge.json"), {
		protocolVersion: 1,
		port: 39_217,
		token: "0123456789abcdef0123456789abcdef",
		pid: process.pid,
		projectPath: fixture.root,
		unityVersion: "6000.0.23f1",
		startedAt: new Date().toISOString(),
		...overrides,
	});
	const discovery = JSON.parse(
		JSON.stringify({
			protocolVersion: 1,
			port: 39_217,
			token: "0123456789abcdef0123456789abcdef",
			pid: process.pid,
			projectPath: fixture.root,
			unityVersion: "6000.0.23f1",
			startedAt: new Date().toISOString(),
			...overrides,
		}),
	) as UnityBridgeDiscovery;
	return discovery;
}

export function writeBridgeFile(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value, null, 2));
}

export const FIXTURE_GUIDS = {
	mainScene: MAIN_SCENE_GUID,
	gameAsmdef: GAME_ASMDEF_GUID,
	editorAsmdef: EDITOR_ASMDEF_GUID,
	sharedAsmdef: SHARED_ASMDEF_GUID,
	gameScript: GAME_SCRIPT_GUID,
} as const;

export const ONE_PIXEL_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
