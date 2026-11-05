import type { UnityBridgeDiscovery } from "../bridge/protocol.ts";

export interface UnityPackage {
	name: string;
	version: string;
	source: string;
	builtin: boolean;
}

export interface UnityAssemblyDefinition {
	name: string;
	path: string;
	rootNamespace?: string;
	references: string[];
	includePlatforms: string[];
	excludePlatforms: string[];
	defineConstraints: string[];
	autoReferenced: boolean;
	allowUnsafeCode: boolean;
	guid?: string;
}

export interface UnityAssemblyNode {
	name: string;
	path: string;
	editorOnly: boolean;
	references: string[];
	resolvedReferences: string[];
	missingReferences: string[];
}

export interface UnityAssemblyGraph {
	nodes: UnityAssemblyNode[];
	byName: Record<string, UnityAssemblyNode>;
	cycles: string[][];
}

export interface UnityAssetSummary {
	name: string;
	path: string;
}

export interface UnityProjectCounts {
	assets: number;
	scripts: number;
	scenes: number;
	prefabs: number;
	assemblies: number;
}

export interface UnityProjectInfo {
	root: string;
	editorVersion: string;
	editorVersionWithRevision?: string;
	productName: string | null;
	companyName: string | null;
	packages: UnityPackage[];
	asmdefs: UnityAssemblyDefinition[];
	assemblyGraph: UnityAssemblyGraph;
	scenes: UnityAssetSummary[];
	prefabs: UnityAssetSummary[];
	counts: UnityProjectCounts;
	bridge: UnityBridgeDiscovery | null;
	warnings: string[];
}

export interface UnityGuidIndex {
	byGuid: Map<string, string>;
	byPath: Map<string, string>;
}

export class UnityProjectError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "UnityProjectError";
		this.code = code;
	}
}
