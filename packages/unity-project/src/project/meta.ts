import { readTextFile, walkUnityContent } from "./paths.ts";
import type { UnityGuidIndex } from "./types.ts";

const GUID_PATTERN = /^\s*guid:\s*([0-9a-fA-F]{32})\s*$/m;

export function parseMetaGuid(text: string): string | null {
	const match = GUID_PATTERN.exec(text);
	return match?.[1]?.toLowerCase() ?? null;
}

export function readAssetGuid(assetAbsolutePath: string): string | null {
	const text = readTextFile(`${assetAbsolutePath}.meta`);
	return text ? parseMetaGuid(text) : null;
}

interface IndexEntry {
	index: UnityGuidIndex;
	builtAt: number;
}

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, IndexEntry>();

export function buildGuidIndex(root: string, options: { refresh?: boolean } = {}): UnityGuidIndex {
	const cached = cache.get(root);
	if (!options.refresh && cached && Date.now() - cached.builtAt < CACHE_TTL_MS) return cached.index;
	const byGuid = new Map<string, string>();
	const byPath = new Map<string, string>();
	for (const file of walkUnityContent(root, { includePackages: true })) {
		if (!file.assetPath.endsWith(".meta")) continue;
		const text = readTextFile(file.absolutePath);
		if (text === null) continue;
		const guid = parseMetaGuid(text);
		if (!guid) continue;
		const assetPath = file.assetPath.slice(0, -".meta".length);
		byGuid.set(guid, assetPath);
		byPath.set(assetPath, guid);
	}
	const index: UnityGuidIndex = { byGuid, byPath };
	cache.set(root, { index, builtAt: Date.now() });
	return index;
}

export function resolveGuid(root: string, guid: string): string | null {
	return buildGuidIndex(root).byGuid.get(guid.toLowerCase()) ?? null;
}

export function clearUnityProjectCaches(): void {
	cache.clear();
}
