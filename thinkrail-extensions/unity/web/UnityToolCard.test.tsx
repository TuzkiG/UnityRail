import { expect, test } from "bun:test";
import type { ToolRenderProps } from "@thinkrail/extension-api/web";
import { renderToStaticMarkup } from "react-dom/server";
import { UnityToolCard } from "./UnityToolCard";

function props(
	toolName: string,
	result: unknown,
	status: ToolRenderProps["status"] = "done",
): ToolRenderProps {
	return { toolCallId: "call-1", toolName, args: {}, result, status, streaming: false };
}

function markup(toolName: string, result: unknown, status?: ToolRenderProps["status"]): string {
	return renderToStaticMarkup(<UnityToolCard {...props(toolName, result, status)} />);
}

test("running calls show a spinner without reading the result", () => {
	expect(markup("unity_compile", null, "running")).toContain("animate-spin");
});

test("failed compiles list diagnostics from details", () => {
	const text = markup("unity_compile", {
		content: [{ type: "text", text: "failed" }],
		details: {
			id: 1,
			state: "failed",
			startedAt: "t",
			diagnostics: [
				{ severity: "error", message: "CS0103: Foo missing", file: "Assets/A.cs", line: 4 },
				{ severity: "warning", message: "obsolete" },
			],
		},
		isError: true,
	});
	expect(text).toContain("CS0103: Foo missing");
	expect(text).toContain("Assets/A.cs:4");
	expect(text).toContain("obsolete");
	expect(text).toContain("Compile failed");
});

test("console cards render entries with their level labels", () => {
	const text = markup("unity_console", {
		content: [],
		details: {
			entries: [{ seq: 3, time: "t", level: "error", message: "boom" }],
			nextSeq: 3,
			dropped: 0,
		},
	});
	expect(text).toContain("boom");
	expect(text).toContain("error");
});

test("test runs render the summary counts and failures", () => {
	const text = markup("unity_tests", {
		content: [],
		details: {
			runId: "run",
			mode: "edit",
			state: "failed",
			startedAt: "t",
			passed: 1,
			failed: 1,
			skipped: 0,
			results: [
				{
					name: "Fails",
					fullName: "T.Fails",
					status: "failed",
					durationMs: 4,
					message: "expected 2",
				},
			],
		},
	});
	expect(text).toContain("T.Fails");
	expect(text).toContain("expected 2");
	expect(text).toContain("Failed");
});

test("hierarchy cards render the nested tree with component types", () => {
	const text = markup("unity_hierarchy", {
		content: [],
		details: {
			scene: "Main",
			scenePath: "Assets/Scenes/Main.unity",
			truncated: false,
			roots: [
				{
					name: "Player",
					path: "Player",
					scene: "Main",
					activeSelf: true,
					activeInHierarchy: true,
					instanceId: 1,
					components: [{ type: "Rigidbody", enabled: true, instanceId: 2 }],
					children: [
						{
							name: "Weapon",
							path: "Player/Weapon",
							scene: "Main",
							activeSelf: true,
							activeInHierarchy: true,
							instanceId: 3,
							components: [],
							children: [],
						},
					],
				},
			],
		},
	});
	expect(text).toContain("Player");
	expect(text).toContain("Weapon");
	expect(text).toContain("Rigidbody");
	expect(text).toContain("Assets/Scenes/Main.unity");
});

test("unrecognized results fall back to the plain result text", () => {
	const text = markup("unity_status", {
		content: [{ type: "text", text: "Play Mode: edit mode." }],
		details: {},
	});
	expect(text).toContain("Play Mode: edit mode.");
});

test("verify cards compose compile, tests and console bodies", () => {
	const text = markup("unity_verify", {
		content: [],
		details: {
			compile: { id: 1, state: "succeeded", startedAt: "t", diagnostics: [] },
			tests: null,
			console: {
				entries: [{ seq: 9, time: "t", level: "log", message: "hello" }],
				nextSeq: 9,
				dropped: 0,
			},
			screenshot: null,
		},
	});
	expect(text).toContain("Compiled");
	expect(text).toContain("hello");
});
