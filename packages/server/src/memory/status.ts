import type { MemoryEngineStatus } from "@thinkrail/contracts";
import { spawnSyncCaptured } from "@thinkrail/shared/spawn";

const PATH_LOOKUP_TIMEOUT_MS = 5_000;

export interface MemoryProbeOptions {
	/** Test seam: the PATH lookup; defaults to `where`/`which` through shared spawn. */
	pathLookup?: (command: string) => boolean;
}

function commandOnPath(command: string): boolean {
	const probe = process.platform === "win32" ? ["where", command] : ["which", command];
	const result = spawnSyncCaptured(probe, { timeoutMs: PATH_LOOKUP_TIMEOUT_MS });
	return result.launched && result.exitCode === 0;
}

/** Reports what the MCP preset and the terminal installer would find. */
export async function probeMemoryEngine(
	options: MemoryProbeOptions = {},
): Promise<MemoryEngineStatus> {
	const pathLookup = options.pathLookup ?? commandOnPath;
	return {
		engine: pathLookup("basic-memory") ? "installed" : "missing",
		uvx: pathLookup("uvx") ? "installed" : "missing",
	};
}
