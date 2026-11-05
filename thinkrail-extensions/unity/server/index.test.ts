import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import unity from "./index";

interface CapturedTool {
	name: string;
	execute: (
		id: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: { cwd: string },
	) => Promise<{ content: { type: string; text?: string }[]; details: unknown; isError?: boolean }>;
}

const roots: string[] = [];

function tempDir(): string {
	const root = mkdtempSync(join(tmpdir(), "ext-unity-"));
	roots.push(root);
	return root;
}

function unityFixture(): string {
	const root = tempDir();
	mkdirSync(join(root, "ProjectSettings"), { recursive: true });
	writeFileSync(
		join(root, "ProjectSettings", "ProjectVersion.txt"),
		"m_EditorVersion: 2022.3.62f3\n",
	);
	return root;
}

function tools(): Map<string, CapturedTool> {
	const registered = new Map<string, CapturedTool>();
	const pi = {
		registerTool: (definition: CapturedTool) => {
			registered.set(definition.name, definition);
		},
		on: () => {},
	} as unknown as ExtensionAPI;
	for (const factory of unity.extensions) factory(pi);
	return registered;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("the unity server half", () => {
	test("registers the sixteen Unity tools once, with the skills package", () => {
		const names = [...tools().keys()].sort();
		expect(names).toEqual(
			[
				"unity_compile",
				"unity_console",
				"unity_doctor",
				"unity_find",
				"unity_hierarchy",
				"unity_inspect",
				"unity_install_bridge",
				"unity_open",
				"unity_open_editor",
				"unity_playmode",
				"unity_project",
				"unity_screenshot",
				"unity_select",
				"unity_status",
				"unity_tests",
				"unity_verify",
			].sort(),
		);
		expect(unity.name).toBe("unity");
		expect(unity.skillPackages).toEqual(["@thinkrail/pi-unity-skills"]);
	});

	test("unity_project explains a workspace that is not a Unity project", async () => {
		const project = tools().get("unity_project");
		if (!project) throw new Error("unity_project is not registered");
		const result = await project.execute("call", {}, undefined, undefined, { cwd: tempDir() });
		expect(result.isError).toBe(true);
		expect((result.details as { error: string }).error).toContain("NOT_UNITY_PROJECT");
	});

	test("unity_project reads a project model from the workspace cwd", async () => {
		const project = tools().get("unity_project");
		if (!project) throw new Error("unity_project is not registered");
		const root = unityFixture();
		const result = await project.execute("call", {}, undefined, undefined, {
			cwd: join(root, "Assets", "Scripts"),
		});
		const details = result.details as { root: string; editorVersion: string };
		expect(result.isError).toBeUndefined();
		expect(details.root).toBe(root);
		expect(details.editorVersion).toBe("2022.3.62f3");
	});
});
