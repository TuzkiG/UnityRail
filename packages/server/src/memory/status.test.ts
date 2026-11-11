import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetConfigCache, updateConfig } from "../settings";
import { probeMemoryEngine } from "./status";

const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	const dataDir = mkdtempSync(join(tmpdir(), "trpi-memory-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
});

afterEach(() => {
	resetConfigCache();
	rmSync(process.env.THINKRAIL_DATA_DIR ?? "", { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

describe("probeMemoryEngine", () => {
	test("reports an installed binary and a running server", async () => {
		const dataDir = process.env.THINKRAIL_DATA_DIR ?? "";
		const binary = join(dataDir, "memory.exe");
		writeFileSync(binary, "stub");
		updateConfig({ extensionSettings: { memory: { memoryBin: binary } } });
		const status = await probeMemoryEngine({
			pathLookup: () => true,
			fetch: async () => new Response(JSON.stringify({ service: "memory" }), { status: 200 }),
		});
		expect(status).toEqual({
			engine: "installed",
			binary,
			server: "running",
			port: 6366,
			url: "http://127.0.0.1:6366",
		});
	});

	test("reports a missing bare name and an absent server", async () => {
		updateConfig({ extensionSettings: { memory: { memoryBin: "memory" } } });
		const status = await probeMemoryEngine({
			pathLookup: () => false,
			fetch: async () => {
				throw new Error("unreachable");
			},
		});
		expect(status.engine).toBe("missing");
		expect(status.server).toBe("absent");
		expect(status.port).toBe(6366);
	});

	test("reports a foreign service on the port and honors a custom port", async () => {
		updateConfig({ extensionSettings: { memory: { memoryBin: "memory", memoryPort: "7000" } } });
		const status = await probeMemoryEngine({
			pathLookup: () => true,
			fetch: async () => new Response(JSON.stringify({ service: "other" }), { status: 200 }),
		});
		expect(status.server).toBe("foreign");
		expect(status.port).toBe(7000);
	});

	test("probes memoryUrl instead of the local port and drops the port", async () => {
		updateConfig({
			extensionSettings: {
				memory: { memoryBin: "memory", memoryUrl: "https://memory.example.com" },
			},
		});
		const status = await probeMemoryEngine({
			pathLookup: () => true,
			fetch: async () => new Response(JSON.stringify({ service: "memory" }), { status: 200 }),
		});
		expect(status.server).toBe("running");
		expect(status.port).toBeNull();
		expect(status.url).toBe("https://memory.example.com");
	});
});
