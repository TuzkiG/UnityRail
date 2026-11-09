import { describe, expect, it } from "bun:test";
import { Type } from "typebox";
import { stripJsonFence, structureResult } from "./structured";

const schema = Type.Object({
	summary: Type.String(),
	tests: Type.Array(Type.String()),
});

describe("structureResult", () => {
	it("returns the formatted JSON and the value when it matches", () => {
		const result = structureResult(schema, '{"summary":"ok","tests":["a"]}', "raw");
		expect(result.text).toBe('{\n  "summary": "ok",\n  "tests": [\n    "a"\n  ]\n}');
		expect(result.structured).toEqual({ summary: "ok", tests: ["a"] });
	});

	it("strips a json fence before parsing", () => {
		const result = structureResult(schema, '```json\n{"summary":"ok","tests":[]}\n```', "raw");
		expect(result.structured).toEqual({ summary: "ok", tests: [] });
	});

	it("explains a schema mismatch and keeps the original text", () => {
		const result = structureResult(schema, '{"summary":1}', "the original");
		expect(result.structured).toBeUndefined();
		expect(result.text).toContain("Result does not match resultSchema:");
		expect(result.text).toContain("/summary");
		expect(result.text.endsWith("the original")).toBe(true);
	});

	it("reports invalid JSON", () => {
		const result = structureResult(schema, "not json", "the original");
		expect(result.text).toContain("Result does not match resultSchema:");
		expect(result.text.endsWith("the original")).toBe(true);
	});

	it("leaves the report alone without a schema or a final text", () => {
		expect(structureResult(undefined, '{"a":1}', "raw")).toEqual({ text: "raw" });
		expect(structureResult(schema, undefined, "raw")).toEqual({ text: "raw" });
		expect(structureResult(schema, "  ", "raw")).toEqual({ text: "raw" });
	});
});

describe("stripJsonFence", () => {
	it("keeps plain text untouched and accepts an unlabelled fence", () => {
		expect(stripJsonFence("hello")).toBe("hello");
		expect(stripJsonFence("```\n{}\n```")).toBe("{}");
	});
});
