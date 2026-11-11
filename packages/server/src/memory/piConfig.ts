import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MemoryPiConfig, MemoryPiConfigPatch } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";

const CONFIG_FILE = join(".pi", "basic-memory.json");
const DEFAULT_CAPTURE_FOLDER = "pi/sessions";
const MAX_CAPTURE_FOLDER = 120;

/** The per-project file the Basic Memory Pi package reads. */
export function memoryPiConfigPath(projectPath: string): string {
	return join(projectPath, CONFIG_FILE);
}

type Json = Record<string, unknown>;

function readRaw(path: string): Json {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : {};
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new CodedError("MEMORY_PI_CONFIG_INVALID", `${path} is not valid JSON`);
		}
		return {};
	}
}

function normalized(raw: Json, path: string, exists: boolean): MemoryPiConfig {
	const transport = raw.transport === "mcp" ? "mcp" : "cli";
	const project = typeof raw.project === "string" && raw.project.trim() ? raw.project.trim() : null;
	const captureFolder =
		typeof raw.captureFolder === "string" && raw.captureFolder.trim()
			? raw.captureFolder.trim()
			: DEFAULT_CAPTURE_FOLDER;
	return {
		path,
		exists,
		transport,
		project,
		captureFolder,
		autoRecall: raw.autoRecall !== false,
		autoCapture: raw.autoCapture !== false,
	};
}

/** Reads the project's Pi integration config, defaulting to what the package itself would use. */
export function readMemoryPiConfig(projectPath: string): MemoryPiConfig {
	const path = memoryPiConfigPath(projectPath);
	const exists = existsSync(path);
	return normalized(exists ? readRaw(path) : {}, path, exists);
}

function captureFolderValue(value: unknown): string {
	if (typeof value !== "string") {
		throw new CodedError("MEMORY_PI_CONFIG_INVALID", "captureFolder must be text");
	}
	const trimmed = value.trim().replace(/^[/\\]+|[/\\]+$/g, "");
	if (trimmed.length === 0 || trimmed.length > MAX_CAPTURE_FOLDER || trimmed.includes("..")) {
		throw new CodedError(
			"MEMORY_PI_CONFIG_INVALID",
			"captureFolder must be a relative folder without '..'",
		);
	}
	return trimmed.split(/[/\\]+/).join("/");
}

function booleanValue(value: unknown, key: string): boolean {
	if (typeof value !== "boolean") {
		throw new CodedError("MEMORY_PI_CONFIG_INVALID", `${key} must be true or false`);
	}
	return value;
}

/**
 * Merges a patch into the project's config, keeping every key this module does not own (the package
 * reads `useHookFlow`, `captureMinChars` and friends, which a user may have set by hand).
 */
export function saveMemoryPiConfig(
	projectPath: string,
	patch: MemoryPiConfigPatch,
): MemoryPiConfig {
	const path = memoryPiConfigPath(projectPath);
	const exists = existsSync(path);
	const raw = exists ? readRaw(path) : {};
	const next: Json = { ...raw };
	if (patch.transport !== undefined) {
		if (patch.transport !== "cli" && patch.transport !== "mcp") {
			throw new CodedError("MEMORY_PI_CONFIG_INVALID", "transport must be cli or mcp");
		}
		next.transport = patch.transport;
	}
	if (patch.project !== undefined) {
		if (patch.project === null || patch.project.trim().length === 0) delete next.project;
		else next.project = patch.project.trim();
	}
	if (patch.captureFolder !== undefined)
		next.captureFolder = captureFolderValue(patch.captureFolder);
	if (patch.autoRecall !== undefined)
		next.autoRecall = booleanValue(patch.autoRecall, "autoRecall");
	if (patch.autoCapture !== undefined)
		next.autoCapture = booleanValue(patch.autoCapture, "autoCapture");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return normalized(next, path, true);
}
