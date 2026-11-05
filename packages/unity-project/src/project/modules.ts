import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readTextFile } from "./paths.ts";

export type UnityModuleKind = "submodule" | "repo" | "external";

export interface UnityDetectedModule {
	name: string;
	/** POSIX path relative to the Unity project for in-project modules, absolute for external ones. */
	path: string;
	kind: UnityModuleKind;
	gitUrl?: string;
}

interface GitmodulesSection {
	name: string;
	path: string;
	url?: string;
}

/**
 * `.gitmodules` is the project's own declaration of the repositories it composes, so it is the first
 * source of truth for linked modules (this is how `Assets/Game` usually arrives).
 */
export function parseGitmodules(text: string): GitmodulesSection[] {
	const sections: GitmodulesSection[] = [];
	let current: GitmodulesSection | null = null;
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		const header = /^\[submodule\s+"(.+)"\]$/.exec(line);
		if (header) {
			current = { name: header[1] ?? "", path: "" };
			sections.push(current);
			continue;
		}
		if (!current) continue;
		const keyValue = /^(path|url)\s*=\s*(.+)$/.exec(line);
		if (!keyValue) continue;
		const value = (keyValue[2] ?? "").trim();
		if (keyValue[1] === "path") current.path = value.replaceAll("\\", "/");
		else current.url = value;
	}
	return sections.filter((section) => section.path.length > 0);
}

/** Top-level `Assets` folders that are their own checkout (a nested repository, not a submodule). */
export function nestedAssetRepositories(projectRoot: string): UnityDetectedModule[] {
	const assets = join(projectRoot, "Assets");
	if (!existsSync(assets)) return [];
	const modules: UnityDetectedModule[] = [];
	for (const entry of readdirSync(assets, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		if (entry.name.startsWith(".") || entry.name.endsWith("~")) continue;
		const path = join(assets, entry.name);
		if (!existsSync(join(path, ".git"))) continue;
		modules.push({ name: `Assets/${entry.name}`, path: `Assets/${entry.name}`, kind: "repo" });
	}
	return modules;
}

export function detectUnityModules(projectRoot: string): UnityDetectedModule[] {
	const modules: UnityDetectedModule[] = [];
	const gitmodules = readTextFile(join(projectRoot, ".gitmodules"));
	if (gitmodules !== null) {
		for (const section of parseGitmodules(gitmodules)) {
			modules.push({
				name: section.name,
				path: section.path,
				kind: "submodule",
				...(section.url ? { gitUrl: section.url } : {}),
			});
		}
	}
	const declared = new Set(modules.map((module) => module.path));
	for (const nested of nestedAssetRepositories(projectRoot)) {
		if (declared.has(nested.path)) continue;
		modules.push(nested);
	}
	return modules;
}
