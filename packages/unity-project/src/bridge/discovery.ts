import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sameProjectPath, stripBom } from "../project/paths.ts";
import type { UnityBridgeDiscovery } from "./protocol.ts";
import {
	UNITY_BRIDGE_DISCOVERY_FILE,
	UNITY_BRIDGE_PROTOCOL_VERSION,
	UNITY_BRIDGE_REGISTRY_FILE,
} from "./protocol.ts";

export interface UnityBridgeRegistryEntry extends UnityBridgeDiscovery {
	updatedAt?: string;
}

interface RegistryFile {
	version?: number;
	bridges?: unknown;
}

export function bridgeDiscoveryPath(projectRoot: string): string {
	return join(projectRoot, "Library", UNITY_BRIDGE_DISCOVERY_FILE);
}

export function bridgeRegistryPath(home = homedir()): string {
	return join(home, ".thinkrail", "unity", UNITY_BRIDGE_REGISTRY_FILE);
}

export function parseBridgeDiscovery(value: unknown): UnityBridgeDiscovery | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;
	const protocolVersion = numberValue(raw.protocolVersion);
	const port = numberValue(raw.port);
	const token = stringValue(raw.token);
	const pid = numberValue(raw.pid);
	const projectPath = stringValue(raw.projectPath);
	const unityVersion = stringValue(raw.unityVersion);
	const startedAt = stringValue(raw.startedAt);
	if (protocolVersion === null || port === null || !token || pid === null || !projectPath)
		return null;
	if (port < 1024 || port > 65_535) return null;
	if (token.length < 16) return null;
	return {
		protocolVersion,
		port,
		token,
		pid,
		projectPath,
		unityVersion: unityVersion ?? "unknown",
		startedAt: startedAt ?? new Date(0).toISOString(),
	};
}

function stringValue(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readProjectBridgeDiscovery(projectRoot: string): UnityBridgeDiscovery | null {
	const path = bridgeDiscoveryPath(projectRoot);
	if (!existsSync(path)) return null;
	try {
		return parseBridgeDiscovery(JSON.parse(stripBom(readFileSync(path, "utf8"))));
	} catch {
		return null;
	}
}

export function readBridgeRegistry(home = homedir()): UnityBridgeRegistryEntry[] {
	const path = bridgeRegistryPath(home);
	if (!existsSync(path)) return [];
	let parsed: RegistryFile;
	try {
		parsed = JSON.parse(stripBom(readFileSync(path, "utf8"))) as RegistryFile;
	} catch {
		return [];
	}
	const raw = parsed.bridges;
	const values = Array.isArray(raw)
		? raw
		: raw && typeof raw === "object"
			? Object.values(raw as Record<string, unknown>)
			: [];
	const entries: UnityBridgeRegistryEntry[] = [];
	for (const value of values) {
		const discovery = parseBridgeDiscovery(value);
		if (!discovery) continue;
		const updatedAt = stringValue((value as Record<string, unknown>).updatedAt);
		entries.push({ ...discovery, ...(updatedAt ? { updatedAt } : {}) });
	}
	return entries;
}

export function readUnityBridgeDiscovery(
	projectRoot: string,
	home = homedir(),
): UnityBridgeDiscovery | null {
	const local = readProjectBridgeDiscovery(projectRoot);
	if (local && isProcessAlive(local.pid)) return local;
	const match = readBridgeRegistry(home).find(
		(entry) => sameProjectPath(entry.projectPath, projectRoot) && isProcessAlive(entry.pid),
	);
	return match ?? null;
}

export function isBridgeProtocolSupported(discovery: UnityBridgeDiscovery): boolean {
	return discovery.protocolVersion === UNITY_BRIDGE_PROTOCOL_VERSION;
}

export function bridgeProjectMatches(
	discovery: UnityBridgeDiscovery,
	projectRoot: string,
): boolean {
	return sameProjectPath(discovery.projectPath, projectRoot);
}

export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === "EPERM";
	}
}
