import { describe, expect, test } from "bun:test";
import { probeMemoryEngine } from "./status";

describe("probeMemoryEngine", () => {
	test("reports an installed engine and uvx", async () => {
		expect(await probeMemoryEngine({ pathLookup: () => true })).toEqual({
			engine: "installed",
			uvx: "installed",
		});
	});

	test("reports a missing engine with uvx available", async () => {
		expect(await probeMemoryEngine({ pathLookup: (command) => command === "uvx" })).toEqual({
			engine: "missing",
			uvx: "installed",
		});
	});

	test("reports neither", async () => {
		expect(await probeMemoryEngine({ pathLookup: () => false })).toEqual({
			engine: "missing",
			uvx: "missing",
		});
	});
});
