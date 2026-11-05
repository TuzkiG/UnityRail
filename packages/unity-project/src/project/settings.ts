import { join } from "node:path";
import { readJsonFile, readTextFile } from "./paths.ts";
import type { UnityPackage } from "./types.ts";

export interface UnityVersionInfo {
	version: string;
	withRevision?: string;
}

export function parseProjectVersion(text: string): UnityVersionInfo | null {
	let version: string | undefined;
	let withRevision: string | undefined;
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*(m_EditorVersion|m_EditorVersionWithRevision):\s*(.+?)\s*$/.exec(line);
		if (!match) continue;
		const value = match[2] ?? "";
		if (match[1] === "m_EditorVersion") version = value;
		else withRevision = value;
	}
	if (!version) return null;
	const info: UnityVersionInfo = { version };
	if (withRevision) info.withRevision = withRevision;
	return info;
}

export function readProjectVersion(root: string): UnityVersionInfo | null {
	const text = readTextFile(join(root, "ProjectSettings", "ProjectVersion.txt"));
	return text ? parseProjectVersion(text) : null;
}

export interface UnitySettingsIdentity {
	productName: string | null;
	companyName: string | null;
}

function yamlScalar(text: string, key: string): string | null {
	const match = new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, "m").exec(text);
	if (!match) return null;
	let value = match[1] ?? "";
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		value = value.slice(1, -1);
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function parseProjectSettings(text: string): UnitySettingsIdentity {
	return {
		productName: yamlScalar(text, "productName"),
		companyName: yamlScalar(text, "companyName"),
	};
}

export function readProjectSettings(root: string): UnitySettingsIdentity {
	const text = readTextFile(join(root, "ProjectSettings", "ProjectSettings.asset"));
	return text ? parseProjectSettings(text) : { productName: null, companyName: null };
}

interface ManifestJson {
	dependencies?: Record<string, string>;
}

interface LockJson {
	dependencies?: Record<string, { version?: string; source?: string; depth?: number }>;
}

const BUILTIN_PREFIX = "com.unity.modules.";

export function parsePackages(manifest: ManifestJson, lock: LockJson | null): UnityPackage[] {
	const dependencies = manifest.dependencies ?? {};
	const locked = lock?.dependencies ?? {};
	const packages: UnityPackage[] = [];
	for (const [name, requested] of Object.entries(dependencies)) {
		const resolved = locked[name];
		const version = resolved?.version ?? requested;
		const source = resolved?.source ?? sourceOf(requested);
		packages.push({
			name,
			version,
			source,
			builtin: name.startsWith(BUILTIN_PREFIX),
		});
	}
	packages.sort((a, b) => a.name.localeCompare(b.name));
	return packages;
}

function sourceOf(requested: string): string {
	if (requested.startsWith("file:")) return "local";
	if (requested.startsWith("git:")) return "git";
	if (requested.startsWith("http:")) return "registry";
	if (requested.startsWith("https:")) return "registry";
	return "registry";
}

export function readPackages(root: string): UnityPackage[] {
	const manifest = readJsonFile<ManifestJson>(join(root, "Packages", "manifest.json"));
	if (!manifest) return [];
	const lock = readJsonFile<LockJson>(join(root, "Packages", "packages-lock.json"));
	return parsePackages(manifest, lock);
}
