import { readTextFile, toAssetPath, walkUnityContent } from "./paths.ts";
import type { UnityAssemblyDefinition, UnityAssemblyGraph, UnityAssemblyNode } from "./types.ts";

interface RawAssemblyDefinition {
	name?: unknown;
	rootNamespace?: unknown;
	references?: unknown;
	includePlatforms?: unknown;
	excludePlatforms?: unknown;
	defineConstraints?: unknown;
	autoReferenced?: unknown;
	allowUnsafeCode?: unknown;
}

const GUID_PREFIX = "GUID:";

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string");
}

export function parseAssemblyDefinition(
	text: string,
	path: string,
	guid?: string,
): UnityAssemblyDefinition | null {
	let raw: RawAssemblyDefinition;
	try {
		raw = JSON.parse(text) as RawAssemblyDefinition;
	} catch {
		return null;
	}
	if (typeof raw.name !== "string" || raw.name.trim().length === 0) return null;
	const definition: UnityAssemblyDefinition = {
		name: raw.name.trim(),
		path,
		references: stringArray(raw.references),
		includePlatforms: stringArray(raw.includePlatforms),
		excludePlatforms: stringArray(raw.excludePlatforms),
		defineConstraints: stringArray(raw.defineConstraints),
		autoReferenced: raw.autoReferenced !== false,
		allowUnsafeCode: raw.allowUnsafeCode === true,
	};
	if (typeof raw.rootNamespace === "string" && raw.rootNamespace.length > 0) {
		definition.rootNamespace = raw.rootNamespace;
	}
	if (guid) definition.guid = guid;
	return definition;
}

export function readAssemblyDefinitions(root: string): UnityAssemblyDefinition[] {
	const definitions: UnityAssemblyDefinition[] = [];
	for (const file of walkUnityContent(root, { includePackages: true })) {
		if (!file.assetPath.endsWith(".asmdef")) continue;
		const text = readTextFile(file.absolutePath);
		if (text === null) continue;
		const guid = readAssemblyGuid(file.absolutePath);
		const definition = parseAssemblyDefinition(text, toAssetPath(root, file.absolutePath), guid);
		if (definition) definitions.push(definition);
	}
	definitions.sort((a, b) => a.name.localeCompare(b.name));
	return definitions;
}

function readAssemblyGuid(asmdefAbsolutePath: string): string | undefined {
	const meta = readTextFile(`${asmdefAbsolutePath}.meta`);
	if (meta === null) return undefined;
	const match = /^\s*guid:\s*([0-9a-fA-F]{32})\s*$/m.exec(meta);
	return match?.[1]?.toLowerCase();
}

export function buildAssemblyGraph(
	definitions: readonly UnityAssemblyDefinition[],
): UnityAssemblyGraph {
	const byGuid = new Map<string, UnityAssemblyDefinition>();
	const byName = new Map<string, UnityAssemblyDefinition>();
	for (const definition of definitions) {
		if (definition.guid) byGuid.set(definition.guid.toLowerCase(), definition);
		byName.set(definition.name, definition);
	}
	const nodes: UnityAssemblyNode[] = definitions.map((definition) => {
		const resolvedReferences: string[] = [];
		const missingReferences: string[] = [];
		for (const reference of definition.references) {
			const target = reference.startsWith(GUID_PREFIX)
				? byGuid.get(reference.slice(GUID_PREFIX.length).toLowerCase())
				: byName.get(reference);
			if (target) resolvedReferences.push(target.name);
			else missingReferences.push(reference);
		}
		return {
			name: definition.name,
			path: definition.path,
			editorOnly:
				definition.includePlatforms.length === 1 && definition.includePlatforms[0] === "Editor",
			references: definition.references,
			resolvedReferences,
			missingReferences,
		};
	});
	const nodeByName = new Map(nodes.map((node) => [node.name, node]));
	return {
		nodes,
		byName: Object.fromEntries(nodeByName) as Record<string, UnityAssemblyNode>,
		cycles: findCycles(nodeByName),
	};
}

function findCycles(byName: ReadonlyMap<string, UnityAssemblyNode>): string[][] {
	const cycles: string[][] = [];
	const state = new Map<string, "visiting" | "done">();
	const stack: string[] = [];

	const visit = (name: string): void => {
		const status = state.get(name);
		if (status === "done") return;
		if (status === "visiting") {
			const start = stack.indexOf(name);
			if (start >= 0) cycles.push([...stack.slice(start), name]);
			return;
		}
		state.set(name, "visiting");
		stack.push(name);
		const node = byName.get(name);
		for (const reference of node?.resolvedReferences ?? []) visit(reference);
		stack.pop();
		state.set(name, "done");
	};
	for (const name of byName.keys()) visit(name);
	return cycles;
}
