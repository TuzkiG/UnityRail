import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
	findUnityProjectRoot,
	UnityBridgeError,
	UnityProjectError,
	type UnityProjectInfo,
} from "@thinkrail/unity-project";

export const MAX_TOOL_TEXT = 48_000;

export function unityProjectRoot(cwd: string): string {
	const root = findUnityProjectRoot(cwd);
	if (!root) {
		throw new UnityProjectError(
			"NOT_UNITY_PROJECT",
			`${cwd} is not inside a Unity project. Open a folder containing ProjectSettings/ProjectVersion.txt, or create a Unity project first.`,
		);
	}
	return root;
}

export function truncate(text: string, max = MAX_TOOL_TEXT): string {
	return text.length <= max ? text : `${text.slice(0, max)}\n[truncated]`;
}

export function textResult<T>(text: string, details: T): AgentToolResult<T> {
	return { content: [{ type: "text", text: truncate(text) }], details };
}

export function errorResult(message: string): AgentToolResult<{ error: string }> {
	return {
		content: [{ type: "text", text: truncate(`Error: ${message}`) }],
		details: { error: message },
		isError: true,
	};
}

export function errorMessage(error: unknown): string {
	if (error instanceof UnityBridgeError || error instanceof UnityProjectError) {
		return `[${error.code}] ${error.message}`;
	}
	return error instanceof Error ? error.message : String(error);
}

export function formatProject(project: UnityProjectInfo): string {
	const name = project.productName ?? project.root.split(/[\\/]/).at(-1) ?? "Unity project";
	const lines: string[] = [];
	lines.push(`Unity project: ${name} (${project.editorVersion})`);
	lines.push(`Root: ${project.root}`);
	if (project.companyName) lines.push(`Company: ${project.companyName}`);

	const packages = project.packages.filter((pkg) => !pkg.builtin);
	lines.push(
		`Packages: ${project.packages.length} total · ${packages.length} project packages${
			packages.length > 0
				? ` (${packages
						.slice(0, 12)
						.map((pkg) => `${pkg.name} ${pkg.version}`)
						.join(", ")}${packages.length > 12 ? ", …" : ""})`
				: ""
		}`,
	);

	lines.push(`Assemblies: ${project.asmdefs.length}`);
	for (const asmdef of project.asmdefs.slice(0, 20)) {
		const references = asmdef.references.length > 0 ? ` -> ${asmdef.references.join(", ")}` : "";
		const editor = asmdef.includePlatforms.includes("Editor") ? " [Editor only]" : "";
		lines.push(`  ${asmdef.name}${editor} (${asmdef.path})${references}`);
	}
	if (project.asmdefs.length > 20) lines.push(`  … ${project.asmdefs.length - 20} more`);

	lines.push(
		`Scenes: ${project.counts.scenes}${
			project.scenes.length > 0
				? ` (${project.scenes
						.slice(0, 12)
						.map((scene) => scene.path)
						.join(", ")}${project.scenes.length > 12 ? ", …" : ""})`
				: ""
		}`,
	);
	lines.push(`Prefabs: ${project.counts.prefabs}`);
	lines.push(`Scripts: ${project.counts.scripts}`);
	lines.push(`Assets: ${project.counts.assets}`);
	lines.push(
		project.bridge
			? `Bridge: running on port ${project.bridge.port} (Unity ${project.bridge.unityVersion})`
			: "Bridge: not running. Open this project in Unity with com.thinkrail.bridge installed, then choose Tools > UnityRail > Start Unity Bridge.",
	);
	if (project.assemblyGraph.cycles.length > 0) {
		lines.push(
			`Assembly cycles: ${project.assemblyGraph.cycles.map((cycle) => cycle.join(" -> ")).join("; ")}`,
		);
	}
	const missing = project.assemblyGraph.nodes.flatMap((node) =>
		node.missingReferences.map((reference) => `${node.name} -> ${reference}`),
	);
	if (missing.length > 0) lines.push(`Missing assembly references: ${missing.join("; ")}`);
	if (project.warnings.length > 0) {
		lines.push(`Warnings:\n${project.warnings.map((warning) => `  - ${warning}`).join("\n")}`);
	}
	return lines.join("\n");
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
