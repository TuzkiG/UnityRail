import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type UnityAssetResult,
	type UnityBridgeStatus,
	type UnityGameObjectInspection,
	type UnityHierarchyNode,
	type UnityHierarchySnapshot,
	withUnityBridge,
} from "@thinkrail/unity-project";
import { Type } from "typebox";
import { errorMessage, errorResult, textResult, unityProjectRoot } from "./shared.ts";

const hierarchyParams = Type.Object({
	scene: Type.Optional(
		Type.String({
			description:
				'Scene to read: "active" (default), a scene path like Assets/Scenes/Main.unity, or "prefab" for the open prefab stage.',
		}),
	),
	depth: Type.Optional(Type.Number({ description: "Maximum displayed depth (default 8)." })),
});

const inspectObject = Type.Object({
	path: Type.String({
		description: "Hierarchy path from the scene root, e.g. 'Player/Weapon'.",
	}),
});

const findParams = Type.Object({
	query: Type.String({ description: "Asset name or search text." }),
	type: Type.Optional(
		Type.String({
			description: 'Optional Unity asset type filter, e.g. "SceneAsset" or "Prefab".',
		}),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum results (default 30, max 100)." })),
});

const pathParams = Type.Object({
	path: Type.String({ description: "Project-relative asset path, e.g. Assets/Scenes/Main.unity." }),
});

const selectParams = Type.Object({
	path: Type.String({ description: "Hierarchy path or project-relative asset path to select." }),
});

const statusParams = Type.Object({});

function formatNode(
	node: UnityHierarchyNode,
	depth: number,
	maxDepth: number,
	lines: string[],
	budget: { count: number },
): void {
	if (budget.count >= 400) return;
	budget.count += 1;
	const indent = "  ".repeat(depth);
	const components = node.components.map((component) => component.type).join(", ");
	const active = node.activeInHierarchy ? "" : " (inactive)";
	lines.push(`${indent}- ${node.name}${active}${components ? ` [${components}]` : ""}`);
	if (depth >= maxDepth) {
		if (node.children.length > 0) lines.push(`${indent}  … ${node.children.length} children`);
		return;
	}
	for (const child of node.children) formatNode(child, depth + 1, maxDepth, lines, budget);
}

export function registerUnitySceneTools(pi: ExtensionAPI): void {
	pi.registerTool<typeof statusParams, UnityBridgeStatus | { error: string }>({
		name: "unity_status",
		label: "Unity Status",
		description:
			"Read the connected Unity Editor's current state: Play Mode, pause, compile, active scene, current selection and last compile result. Use it to orient before a Unity action.",
		promptSnippet:
			"unity_status — read Play Mode, compile, active scene and selection from the connected Editor.",
		parameters: statusParams,
		async execute(_callId, _params, signal, _onUpdate, ctx) {
			try {
				const root = unityProjectRoot(ctx.cwd);
				const status = await withUnityBridge(root, (client) => client.status(signal), {
					retryUnavailable: true,
					...(signal ? { signal } : {}),
				});
				const mode = status.isPlaying ? (status.isPaused ? "paused" : "playing") : "edit mode";
				const lines = [
					`Unity ${status.unityVersion}: ${mode}.`,
					`Scene: ${status.activeScene ?? "(none)"}`,
					`Compile: ${status.isCompiling ? "running" : (status.lastCompile?.state ?? "not run through the bridge")}`,
					`Selection: ${status.selection.length > 0 ? status.selection.map((entry) => `${entry.name} (${entry.type})`).join(", ") : "(none)"}`,
					`Console sequence: ${status.consoleSeq}`,
				];
				return textResult(lines.join("\n"), status);
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});

	pi.registerTool<typeof hierarchyParams, UnityHierarchySnapshot | { error: string }>({
		name: "unity_hierarchy",
		label: "Unity Hierarchy",
		description:
			"Read the open scene's GameObject hierarchy with component types, active state and stable paths. Use the returned path with unity_inspect, unity_select, and scene work instead of guessing object names.",
		promptSnippet:
			"unity_hierarchy — read the active scene hierarchy with component types and paths.",
		parameters: hierarchyParams,
		async execute(_callId, params, signal, _onUpdate, ctx) {
			try {
				const root = unityProjectRoot(ctx.cwd);
				const snapshot = await withUnityBridge(
					root,
					(client) => client.hierarchy(params.scene, signal),
					{ retryUnavailable: true, ...(signal ? { signal } : {}) },
				);
				const depth = Math.min(Math.max(params.depth ?? 8, 1), 32);
				const lines = [
					`Scene ${snapshot.scene} (${snapshot.scenePath || "unsaved"})${snapshot.truncated ? " [truncated]" : ""}`,
				];
				const budget = { count: 0 };
				for (const node of snapshot.roots) formatNode(node, 0, depth, lines, budget);
				if (snapshot.roots.length === 0) lines.push("(empty scene)");
				if (budget.count >= 400) lines.push("… display truncated at 400 objects");
				return textResult(lines.join("\n"), snapshot);
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});

	pi.registerTool<typeof inspectObject, UnityGameObjectInspection | { error: string }>({
		name: "unity_inspect",
		label: "Unity Inspect",
		description:
			"Inspect one GameObject by hierarchy path: components and their serialized property values. Use it to check what a scene object actually has before changing code or asking the user.",
		promptSnippet:
			"unity_inspect — read a GameObject's components and serialized properties by hierarchy path.",
		parameters: inspectObject,
		async execute(_callId, params, signal, _onUpdate, ctx) {
			try {
				const root = unityProjectRoot(ctx.cwd);
				const inspection = await withUnityBridge(
					root,
					(client) => client.inspect(params.path, signal),
					{ retryUnavailable: true, ...(signal ? { signal } : {}) },
				);
				const lines = [
					`${inspection.name} (${inspection.scene}) · tag ${inspection.tag} · layer ${inspection.layer}${inspection.activeSelf ? "" : " · inactive"}`,
				];
				for (const component of inspection.components) {
					lines.push(`\n${component.type}${component.enabled ? "" : " (disabled)"}`);
					for (const property of component.properties) {
						lines.push(`  ${property.name}: ${property.value}`);
					}
				}
				return textResult(lines.join("\n"), inspection);
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});

	pi.registerTool<typeof findParams, UnityAssetResult[] | { error: string }>({
		name: "unity_find",
		label: "Unity Find Assets",
		description:
			"Search the Unity Asset Database by name and optional asset type. Returns project-relative paths, GUIDs and asset types for scenes, prefabs, scripts, materials and other assets.",
		promptSnippet: "unity_find — search the Unity Asset Database by name and asset type.",
		parameters: findParams,
		async execute(_callId, params, signal, _onUpdate, ctx) {
			try {
				const root = unityProjectRoot(ctx.cwd);
				const assets = await withUnityBridge(
					root,
					(client) =>
						client.find(params.query, {
							...(params.type ? { type: params.type } : {}),
							...(params.limit === undefined ? {} : { limit: params.limit }),
							signal,
						}),
					{ retryUnavailable: true, ...(signal ? { signal } : {}) },
				);
				const lines = [
					`${assets.length} asset${assets.length === 1 ? "" : "s"} for "${params.query}".`,
				];
				for (const asset of assets) {
					lines.push(`${asset.path} [${asset.type}] guid ${asset.guid}`);
				}
				return textResult(lines.join("\n"), assets);
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});

	pi.registerTool<typeof pathParams, { ok: boolean; path: string } | { error: string }>({
		name: "unity_open",
		label: "Unity Open",
		description:
			"Open a scene or asset in the Unity Editor. Opening a scene with unsaved changes is refused; ask the user to save or discard first.",
		promptSnippet: "unity_open — open a project-relative scene or asset in Unity.",
		parameters: pathParams,
		async execute(_callId, params, signal, _onUpdate, ctx) {
			try {
				const root = unityProjectRoot(ctx.cwd);
				const opened = await withUnityBridge(
					root,
					(client) => client.open(params.path, signal),
					signal ? { signal } : {},
				);
				return textResult(`Opened ${opened.path} in Unity.`, opened);
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});

	pi.registerTool<typeof selectParams, { ok: boolean } | { error: string }>({
		name: "unity_select",
		label: "Unity Select",
		description:
			"Select a GameObject by hierarchy path, or an asset by project path, in the Unity Editor. Use it to point the user at the object the next step is about.",
		promptSnippet: "unity_select — select a GameObject or asset in the Unity Editor.",
		parameters: selectParams,
		async execute(_callId, params, signal, _onUpdate, ctx) {
			try {
				const root = unityProjectRoot(ctx.cwd);
				const selected = await withUnityBridge(
					root,
					(client) => client.select(params.path, signal),
					signal ? { signal } : {},
				);
				return textResult(`Selected ${params.path} in Unity.`, selected);
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});
}
