import { describe, expect, test } from "bun:test";
import { memoryCliSupported, probeMemoryEngine } from "./status";

describe("memoryCliSupported", () => {
	test("requires v0.24 or newer", () => {
		expect(memoryCliSupported("0.24.0")).toBe(true);
		expect(memoryCliSupported("0.30.2")).toBe(true);
		expect(memoryCliSupported("1.0.0")).toBe(true);
		expect(memoryCliSupported("0.23.9")).toBe(false);
		expect(memoryCliSupported(null)).toBe(false);
		expect(memoryCliSupported("garbage")).toBe(false);
	});
});

describe("probeMemoryEngine", () => {
	test("reports an installed, supported CLI with uv and the Pi package", async () => {
		const status = await probeMemoryEngine({
			pathLookup: () => true,
			versionOf: () => "0.27.1",
			piPackageDir: __dirname,
		});
		expect(status.cli).toEqual({ installed: true, version: "0.27.1", supported: true });
		expect(status.uv).toBe(true);
		expect(status.piPackage).toBe(true);
	});

	test("reports a missing CLI, missing uv and a missing Pi package", async () => {
		const status = await probeMemoryEngine({
			pathLookup: () => false,
			versionOf: () => {
				throw new Error("must not run");
			},
			piPackageDir: `${__dirname}/definitely-missing`,
		});
		expect(status.cli).toEqual({ installed: false, version: null, supported: false });
		expect(status.uv).toBe(false);
		expect(status.piPackage).toBe(false);
	});
});
