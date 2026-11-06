import { describe, expect, test } from "bun:test";
import { formatEditorToolResult, formatEditorTools } from "./tools.ts";

describe("formatEditorTools", () => {
	test("explains how a project adds a tool when it has none", () => {
		expect(formatEditorTools([])).toContain("[BridgeTool");
	});

	test("lists the name, description and parameter documentation", () => {
		const text = formatEditorTools([
			{
				name: "bake_tiles",
				description: "Bake the tilemap into a texture.",
				parameters: "output: project-relative folder",
			},
			{ name: "clear_cache", description: "" },
		]);
		expect(text).toContain("2 project Editor tools registered:");
		expect(text).toContain("- bake_tiles — Bake the tilemap into a texture.");
		expect(text).toContain("parameters: output: project-relative folder");
		expect(text).toContain("- clear_cache");
		expect(text).toContain("unity_editor_tool { name, parameters }");
	});

	test("truncates a long description and summarizes the tools it did not spell out", () => {
		const tools = Array.from({ length: 45 }, (_, index) => ({
			name: `tool_${index}`,
			description: "x".repeat(400),
		}));
		const text = formatEditorTools(tools);
		expect(text).toContain("… and 5 more.");
		expect(text).not.toContain("tool_44");
		expect(text.split("\n").every((line) => line.length < 300)).toBe(true);
	});
});

describe("formatEditorToolResult", () => {
	test("prints a string result as-is and JSON otherwise", () => {
		expect(formatEditorToolResult("bake", "done")).toBe("bake: done");
		expect(formatEditorToolResult("bake", { textures: 2 })).toContain('"textures": 2');
		expect(formatEditorToolResult("bake", null)).toBe("bake returned nothing.");
	});
});
