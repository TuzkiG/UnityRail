import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { readUnityBridgeDiscovery } from "../bridge/discovery.ts";
import type { UnityBridgeDiscovery } from "../bridge/protocol.ts";
import { buildAssemblyGraph, readAssemblyDefinitions } from "./asmdef.ts";
import { assertUnityProject, walkUnityContentBounded } from "./paths.ts";
import { readPackages, readProjectSettings, readProjectVersion } from "./settings.ts";
import type { UnityAssetSummary, UnityProjectInfo } from "./types.ts";

const UNITY_EDITOR_PATHS = {
	win32: ["C:\\Program Files\\Unity\\Hub\\Editor", "C:\\Program Files\\Unity Hub\\Editor"],
	darwin: ["/Applications/Unity/Hub/Editor"],
	linux: [join(process.env.HOME ?? "", "Unity", "Hub", "Editor")],
} as const;

export interface ReadUnityProjectOptions {
	includeBridge?: boolean;
	maxFiles?: number;
}

export function readUnityProject(
	root: string,
	options: ReadUnityProjectOptions = {},
): UnityProjectInfo {
	const resolved = resolve(root);
	assertUnityProject(resolved);
	const warnings: string[] = [];
	const version = readProjectVersion(resolved);
	if (!version) warnings.push("ProjectSettings/ProjectVersion.txt has no m_EditorVersion.");
	const identity = readProjectSettings(resolved);
	const packages = readPackages(resolved);
	const asmdefs = readAssemblyDefinitions(resolved);
	const graph = buildAssemblyGraph(asmdefs);
	if (graph.cycles.length > 0) {
		warnings.push(
			`Assembly definition cycle: ${graph.cycles.map((cycle) => cycle.join(" -> ")).join("; ")}`,
		);
	}
	for (const node of graph.nodes) {
		if (node.missingReferences.length > 0) {
			warnings.push(
				`${node.name} references missing assembly: ${node.missingReferences.join(", ")}`,
			);
		}
	}

	const scenes: UnityAssetSummary[] = [];
	const prefabs: UnityAssetSummary[] = [];
	let scripts = 0;
	let assets = 0;
	const maxFiles = options.maxFiles ?? 60_000;
	const walk = walkUnityContentBounded(resolved, { maxFiles });
	for (const file of walk.files) {
		if (file.assetPath.endsWith(".meta")) continue;
		assets += 1;
		if (file.assetPath.endsWith(".cs")) scripts += 1;
		if (file.assetPath.endsWith(".unity")) {
			scenes.push({ name: baseName(file.assetPath), path: file.assetPath });
		} else if (file.assetPath.endsWith(".prefab")) {
			prefabs.push({ name: baseName(file.assetPath), path: file.assetPath });
		}
	}
	if (walk.truncated) warnings.push(`Project scan stopped at ${maxFiles} files.`);
	scenes.sort((a, b) => a.path.localeCompare(b.path));
	prefabs.sort((a, b) => a.path.localeCompare(b.path));

	let bridge: UnityBridgeDiscovery | null = null;
	if (options.includeBridge !== false) {
		bridge = readUnityBridgeDiscovery(resolved);
	}
	if (version && packages.length === 0) {
		warnings.push("Packages/manifest.json is missing or empty.");
	}

	return {
		root: resolved,
		editorVersion: version?.version ?? "unknown",
		...(version?.withRevision ? { editorVersionWithRevision: version.withRevision } : {}),
		productName: identity.productName,
		companyName: identity.companyName,
		packages,
		asmdefs,
		assemblyGraph: graph,
		scenes,
		prefabs,
		counts: {
			assets,
			scripts,
			scenes: scenes.length,
			prefabs: prefabs.length,
			assemblies: asmdefs.length,
		},
		bridge,
		warnings,
	};
}

function baseName(path: string): string {
	const file = path.split("/").at(-1) ?? path;
	return file.replace(/\.[^.]+$/, "");
}

/**
 * Find the Unity executable for an editor version. The Hub stores editors in one versioned folder per
 * install; a custom install can be named through `UNITY_EDITOR_PATH` or `THINKRAIL_UNITY_EDITOR`.
 */
export function findUnityInstall(version: string): string | null {
	const explicit = process.env.THINKRAIL_UNITY_EDITOR ?? process.env.UNITY_EDITOR_PATH;
	if (explicit && existsSync(explicit)) return explicit;
	const platform =
		process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
	const roots = UNITY_EDITOR_PATHS[platform];
	const executable =
		platform === "win32"
			? join("Editor", "Unity.exe")
			: platform === "darwin"
				? join("Unity.app", "Contents", "MacOS", "Unity")
				: join("Editor", "Unity");
	for (const root of roots) {
		const direct = join(root, version, executable);
		if (existsSync(direct)) return direct;
	}
	// A version built with a suffix (6000.0.23f1c1) can share the requested prefix; prefer an exact
	// match and otherwise take the newest installed editor with that version prefix.
	for (const root of roots) {
		if (!existsSync(root)) continue;
		let entries: string[] = [];
		try {
			entries = readdirSync(root, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
				.filter((name) => name === version || name.startsWith(`${version}`))
				.sort()
				.reverse();
		} catch {
			continue;
		}
		for (const name of entries) {
			const candidate = join(root, name, executable);
			if (existsSync(candidate)) return candidate;
		}
	}
	return null;
}
