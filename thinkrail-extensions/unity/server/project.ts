import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	clearUnityProjectCaches,
	diagnoseUnityWorkspace,
	installBridgePackage,
	openUnityProject,
	readUnityProject,
	type UnityDoctorResult,
	type UnityProjectInfo,
} from "@thinkrail/unity-project";

/** Project details for tool results: the bridge discovery is projected so the session bearer token
 * never lands in a transcript. */
export type UnityProjectToolDetails = Omit<UnityProjectInfo, "bridge"> & {
	bridge: {
		port: number;
		pid: number;
		unityVersion: string;
		startedAt: string;
	} | null;
};

function toolDetails(project: UnityProjectInfo): UnityProjectToolDetails {
	return {
		...project,
		bridge: project.bridge
			? {
					port: project.bridge.port,
					pid: project.bridge.pid,
					unityVersion: project.bridge.unityVersion,
					startedAt: project.bridge.startedAt,
				}
			: null,
	};
}

import { Type } from "typebox";
import {
	errorMessage,
	errorResult,
	formatProject,
	textResult,
	unityProjectRoot,
} from "./shared.ts";

const projectParams = Type.Object({
	refresh: Type.Optional(
		Type.Boolean({
			description: "Drop the cached GUID/asset index before reading the project.",
		}),
	),
});

const doctorParams = Type.Object({});

const openEditorParams = Type.Object({});

const installBridgeParams = Type.Object({});

export function registerUnityProjectTools(pi: ExtensionAPI): void {
	pi.registerTool<typeof projectParams, UnityProjectToolDetails | { error: string }>({
		name: "unity_project",
		label: "Unity Project",
		description:
			"Read the Unity project this workspace belongs to: editor version, product name, packages, assembly definitions and their dependency graph, scenes, prefabs, script/asset counts, and whether the UnityRail Unity bridge is running. Use this before changing Unity code so you know the assemblies, packages, and scenes you are working with.",
		promptSnippet:
			"unity_project — read the Unity project model: version, packages, asmdef graph, scenes, prefabs, bridge state.",
		parameters: projectParams,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			try {
				if (params.refresh === true) clearUnityProjectCaches();
				const root = unityProjectRoot(ctx.cwd);
				const project = readUnityProject(root);
				return textResult(formatProject(project), toolDetails(project));
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});

	pi.registerTool<typeof doctorParams, UnityDoctorResult | { error: string }>({
		name: "unity_doctor",
		label: "Unity Doctor",
		description:
			"Diagnose why the Unity verification loop is not working: project detection, Unity install, bridge connectivity, bridge/workspace project mismatch, compile state, assembly cycles and missing assembly references. Run this first when a Unity tool fails, then fix the highest-severity finding.",
		promptSnippet:
			"unity_doctor — diagnose Unity project, install, bridge connection, compile state, and asmdef problems.",
		parameters: doctorParams,
		async execute(_callId, _params, signal, _onUpdate, ctx) {
			const report = await diagnoseUnityWorkspace(ctx.cwd, { signal });
			const lines: string[] = [];
			lines.push(
				report.workspaceIsUnityProject
					? `Unity workspace: ${report.root}`
					: "Not a Unity workspace.",
			);
			if (report.workspaceIsUnityProject) {
				lines.push(
					`Unity ${report.editorVersion}${report.productName ? ` · ${report.productName}` : ""}`,
				);
				lines.push(
					report.bridgeConnected
						? `Bridge: connected${report.bridgeMatchesWorkspace ? "" : " (different project)"}`
						: "Bridge: not connected",
				);
				lines.push(
					report.unityInstalled
						? `Unity install: ${report.editorPath}`
						: "Unity install: not found",
				);
			}
			if (report.findings.length === 0) {
				lines.push("No problems found.");
			} else {
				lines.push("");
				for (const finding of report.findings) {
					lines.push(`[${finding.severity}] ${finding.code}: ${finding.message}`);
				}
			}
			const result = textResult(lines.join("\n"), report);
			return report.findings.some((finding) => finding.severity === "error")
				? { ...result, isError: true }
				: result;
		},
	});

	pi.registerTool<
		typeof installBridgeParams,
		| {
				installed: boolean;
				alreadyInstalled: boolean;
				updated: boolean;
				path: string;
				packageName: string;
				packageVersion: string;
				files: number;
		  }
		| { error: string }
	>({
		name: "unity_install_bridge",
		label: "Install Unity Bridge",
		description:
			"Install the bundled Unity Editor bridge package into this Unity project by copying it to Packages/com.thinkrail.bridge (Unity's embedded-package folder). Needed once per project before any live Unity tool can work; after installing, open the project in Unity so the bridge starts.",
		promptSnippet:
			"unity_install_bridge — install the bundled Unity bridge package into this project so Unity tools can connect.",
		parameters: installBridgeParams,
		async execute(_callId, _params, _signal, _onUpdate, ctx) {
			try {
				const root = unityProjectRoot(ctx.cwd);
				const result = await installBridgePackage(root);
				const action = result.updated
					? "Updated"
					: result.alreadyInstalled
						? "Already installed"
						: "Installed";
				return textResult(
					`${action}: ${result.packageName}@${result.packageVersion} in ${result.path}${result.files > 0 ? ` (${result.files} files)` : ""}.
Unity reimports the package on its next focus; open the project and the bridge starts automatically.`,
					result,
				);
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});

	pi.registerTool<
		typeof openEditorParams,
		{ started: boolean; editorPath: string; pid: number | null } | { error: string }
	>({
		name: "unity_open_editor",
		label: "Open in Unity",
		description:
			"Launch the Unity Editor for this workspace using the matching installed Unity version. Use this when the bridge is not running or has a different project open. The Editor takes time to import and start the bridge; run unity_doctor afterwards instead of assuming the bridge is up.",
		promptSnippet:
			"unity_open_editor — launch the matching Unity Editor for this workspace when the bridge is unavailable.",
		parameters: openEditorParams,
		async execute(_callId, _params, _signal, _onUpdate, ctx) {
			try {
				const root = unityProjectRoot(ctx.cwd);
				const project = readUnityProject(root, { includeBridge: true });
				if (project.bridge) {
					return textResult(
						`Unity is already running for this project on port ${project.bridge.port}. Use unity_doctor or unity_compile to talk to it.`,
						{ started: false, editorPath: "", pid: project.bridge.pid },
					);
				}
				const launched = openUnityProject(root);
				return textResult(
					`Started Unity for ${root} (pid ${launched.pid ?? "unknown"}).\nEditor: ${launched.editorPath}\nUnity imports the project and starts the bridge on its own; check unity_doctor after it finishes loading.`,
					launched,
				);
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});
}
