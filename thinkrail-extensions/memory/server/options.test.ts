import { describe, expect, test } from "bun:test";
import type { ExtensionSessionServices } from "@thinkrail/extension-api/server";
import {
	MEMORY_STRINGS,
	MEMORY_TOGGLES,
	type MemoryString,
	type MemoryToggle,
} from "../shared/keys.ts";
import { readMemoryOptions } from "./options.ts";

function session(settings: Record<string, boolean | string>): ExtensionSessionServices {
	return {
		expectToolResponse: () => {},
		awaitToolResponse: () => Promise.reject(new Error("no session")),
		workspaceFiles: { check: () => Promise.resolve(), scratchDir: "" },
		setting: (key) => {
			const value = settings[key];
			return typeof value === "boolean" ? value : MEMORY_TOGGLES[key as MemoryToggle];
		},
		stringSetting: (key) => {
			const value = settings[key];
			return typeof value === "string" ? value : MEMORY_STRINGS[key as MemoryString];
		},
	};
}

describe("readMemoryOptions", () => {
	test("defaults to enabled with the adapter's own defaults", () => {
		expect(readMemoryOptions(session({}))).toEqual({
			enabled: true,
			memoryBin: "memory",
			memoryPort: "6366",
			memoryUrl: "",
		});
	});

	test("reads stored values", () => {
		expect(
			readMemoryOptions(
				session({
					enabled: false,
					memoryBin: "C:/tools/memory.exe",
					memoryPort: "7000",
					memoryUrl: "https://memory.example.com",
				}),
			),
		).toEqual({
			enabled: false,
			memoryBin: "C:/tools/memory.exe",
			memoryPort: "7000",
			memoryUrl: "https://memory.example.com",
		});
	});
});
