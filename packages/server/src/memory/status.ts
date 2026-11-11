import { existsSync } from "node:fs";
import type { MemoryEngineStatus } from "@thinkrail/contracts";
import { spawnSyncCaptured } from "@thinkrail/shared/spawn";
import { getConfig } from "../settings";

const DEFAULT_BINARY = "memory";
const DEFAULT_PORT = 6366;
const HEALTH_TIMEOUT_MS = 500;
const PATH_LOOKUP_TIMEOUT_MS = 5_000;

export interface MemoryProbeOptions {
	/** Test seam: the health-check fetch; defaults to the global fetch. */
	fetch?: (input: string, init?: RequestInit) => Promise<Response>;
	/** Test seam: the binary PATH lookup; defaults to `where`/`which` through shared spawn. */
	pathLookup?: (binary: string) => boolean;
}

function memorySettings(): { binary: string; port: number; url: string } {
	const settings = getConfig().extensionSettings?.["memory"];
	const portText =
		typeof settings?.memoryPort === "string" && settings.memoryPort.trim()
			? settings.memoryPort.trim()
			: String(DEFAULT_PORT);
	const parsed = Number.parseInt(portText, 10);
	return {
		binary:
			typeof settings?.memoryBin === "string" && settings.memoryBin.trim()
				? settings.memoryBin.trim()
				: DEFAULT_BINARY,
		port: Number.isFinite(parsed) ? parsed : DEFAULT_PORT,
		url: typeof settings?.memoryUrl === "string" ? settings.memoryUrl.trim() : "",
	};
}

function binaryOnPath(binary: string): boolean {
	const probe = process.platform === "win32" ? ["where", binary] : ["which", binary];
	const result = spawnSyncCaptured(probe, { timeoutMs: PATH_LOOKUP_TIMEOUT_MS });
	return result.launched && result.exitCode === 0;
}

async function probeHealth(
	url: string,
	fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<"running" | "absent" | "foreign"> {
	let response: Response;
	try {
		response = await fetchImpl(url, {
			headers: { "X-Memory-Client": "thinkrail/host" },
			signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
		});
	} catch {
		return "absent";
	}
	try {
		const data = (await response.json()) as { service?: unknown } | null;
		if (data?.service !== "memory") return "foreign";
		return response.ok ? "running" : "foreign";
	} catch {
		return "foreign";
	}
}

/** Reads the memory extension's settings and reports what the adapter would find. */
export async function probeMemoryEngine(
	options: MemoryProbeOptions = {},
): Promise<MemoryEngineStatus> {
	const { binary, port, url } = memorySettings();
	const pathLookup = options.pathLookup ?? binaryOnPath;
	const fetchImpl = options.fetch ?? fetch;
	const absolute = binary.includes("/") || binary.includes("\\");
	const engine: MemoryEngineStatus["engine"] = (absolute ? existsSync(binary) : pathLookup(binary))
		? "installed"
		: "missing";
	const target = url || `http://127.0.0.1:${port}`;
	const server = await probeHealth(`${target}/health`, fetchImpl);
	return {
		engine,
		binary,
		server,
		port: url ? null : port,
		url: target,
	};
}
