import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MemoryEngineStatus } from "@thinkrail/contracts";
import { spawnSyncCaptured } from "@thinkrail/shared/spawn";
import { memoryConfigPath } from "./config";

/** The Basic Memory release the Pi package needs (`bm` v0.24+). */
export const MEMORY_MIN_CLI_MINOR = 24;

const PATH_LOOKUP_TIMEOUT_MS = 5_000;
const VERSION_TIMEOUT_MS = 5_000;

export interface MemoryProbeOptions {
	/** Test seam: the PATH lookup; defaults to `where`/`which` through shared spawn. */
	pathLookup?: (command: string) => boolean;
	/** Test seam: runs `<command> --version` and returns its stdout; defaults to bounded spawn. */
	versionOf?: (command: string) => string | null;
	/** Test seam: the Pi package folder; defaults to `<pi agent dir>/packages/basic-memory`. */
	piPackageDir?: string;
}

function commandOnPath(command: string): boolean {
	const probe = process.platform === "win32" ? ["where", command] : ["which", command];
	const result = spawnSyncCaptured(probe, { timeoutMs: PATH_LOOKUP_TIMEOUT_MS });
	return result.launched && result.exitCode === 0;
}

function versionOf(command: string): string | null {
	const result = spawnSyncCaptured([command, "--version"], { timeoutMs: VERSION_TIMEOUT_MS });
	if (!result.launched || result.exitCode !== 0) return null;
	const match = /\d+\.\d+(?:\.\d+)?/.exec(result.stdout);
	return match?.[0] ?? null;
}

/** `bm --version` answers `basic-memory 0.x.y`; anything below 0.24 lacks the Pi package installer. */
export function memoryCliSupported(version: string | null): boolean {
	if (!version) return false;
	const [major = Number.NaN, minor = Number.NaN] = version
		.split(".")
		.map((part) => Number.parseInt(part, 10));
	if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
	if (major > 0) return true;
	return minor >= MEMORY_MIN_CLI_MINOR;
}

function piAgentDir(): string {
	const override = process.env.PI_CODING_AGENT_DIR?.trim();
	return override || join(homedir(), ".pi", "agent");
}

/** Reports what the Pi integration and the terminal installer would find. */
export async function probeMemoryEngine(
	options: MemoryProbeOptions = {},
): Promise<MemoryEngineStatus> {
	const pathLookup = options.pathLookup ?? commandOnPath;
	const readVersion = options.versionOf ?? versionOf;
	// v0.24 ships the `bm` alias; older installs only answer to `basic-memory`.
	const command = pathLookup("bm") ? "bm" : pathLookup("basic-memory") ? "basic-memory" : null;
	const version = command ? readVersion(command) : null;
	const piPackageDir = options.piPackageDir ?? join(piAgentDir(), "packages", "basic-memory");
	return {
		cli: { installed: command !== null, version, supported: memoryCliSupported(version) },
		uv: pathLookup("uv"),
		piPackage: existsSync(piPackageDir),
		configPath: memoryConfigPath(),
	};
}
