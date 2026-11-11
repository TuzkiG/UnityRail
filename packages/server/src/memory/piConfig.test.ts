import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodedError } from "@thinkrail/shared/codedError";
import { readMemoryPiConfig, saveMemoryPiConfig } from "./piConfig";

let projectPath: string;

beforeEach(() => {
	projectPath = mkdtempSync(join(tmpdir(), "trpi-bm-pi-config-"));
});

afterEach(() => {
	rmSync(projectPath, { recursive: true, force: true });
});

function writeConfig(value: unknown): void {
	mkdirSync(join(projectPath, ".pi"), { recursive: true });
	writeFileSync(join(projectPath, ".pi", "basic-memory.json"), JSON.stringify(value), "utf8");
}

function readFile(): Record<string, unknown> {
	return JSON.parse(readFileSync(join(projectPath, ".pi", "basic-memory.json"), "utf8"));
}

describe("readMemoryPiConfig", () => {
	test("answers the package's own defaults before the file exists", () => {
		expect(readMemoryPiConfig(projectPath)).toEqual({
			path: join(projectPath, ".pi", "basic-memory.json"),
			exists: false,
			transport: "cli",
			project: null,
			captureFolder: "pi/sessions",
			autoRecall: true,
			autoCapture: true,
		});
	});

	test("reads a stored config", () => {
		writeConfig({
			transport: "mcp",
			project: "thinkrail",
			captureFolder: "notes/pi",
			autoRecall: false,
			autoCapture: true,
			useHookFlow: true,
		});
		expect(readMemoryPiConfig(projectPath)).toMatchObject({
			exists: true,
			transport: "mcp",
			project: "thinkrail",
			captureFolder: "notes/pi",
			autoRecall: false,
			autoCapture: true,
		});
	});

	test("rejects a file that is not JSON", () => {
		mkdirSync(join(projectPath, ".pi"), { recursive: true });
		writeFileSync(join(projectPath, ".pi", "basic-memory.json"), "{ nope", "utf8");
		expect(() => readMemoryPiConfig(projectPath)).toThrow(CodedError);
	});
});

describe("saveMemoryPiConfig", () => {
	test("writes the patch and keeps keys it does not own", () => {
		writeConfig({ useHookFlow: false, captureMinChars: 40 });
		const saved = saveMemoryPiConfig(projectPath, {
			project: "thinkrail",
			autoCapture: false,
		});
		expect(saved).toMatchObject({ project: "thinkrail", autoCapture: false });
		expect(readFile()).toEqual({
			useHookFlow: false,
			captureMinChars: 40,
			project: "thinkrail",
			autoCapture: false,
		});
	});

	test("clears the project with null", () => {
		writeConfig({ project: "thinkrail" });
		expect(saveMemoryPiConfig(projectPath, { project: null }).project).toBeNull();
		expect(readFile().project).toBeUndefined();
	});

	test("normalizes a capture folder and rejects one that escapes", () => {
		expect(saveMemoryPiConfig(projectPath, { captureFolder: "/notes//pi/" }).captureFolder).toBe(
			"notes/pi",
		);
		expect(() => saveMemoryPiConfig(projectPath, { captureFolder: "../outside" })).toThrow(
			CodedError,
		);
		expect(() => saveMemoryPiConfig(projectPath, { captureFolder: "" })).toThrow(CodedError);
	});

	test("rejects an unknown transport or a non-boolean toggle", () => {
		expect(() =>
			saveMemoryPiConfig(projectPath, {
				transport: "stdio" as unknown as "cli",
			}),
		).toThrow(CodedError);
		expect(() =>
			saveMemoryPiConfig(projectPath, { autoRecall: "yes" as unknown as boolean }),
		).toThrow(CodedError);
	});
});
