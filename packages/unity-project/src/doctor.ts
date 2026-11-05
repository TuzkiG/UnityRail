import { connectUnityBridge, UnityBridgeError } from "./bridge/client.ts";
import { readUnityBridgeDiscovery } from "./bridge/discovery.ts";
import type {
	UnityBridgeStatus,
	UnityDoctorFinding,
	UnityDoctorReport,
} from "./bridge/protocol.ts";
import { findUnityProjectRoot } from "./project/paths.ts";
import { findUnityInstall, readUnityProject } from "./project/project.ts";
import { UnityProjectError } from "./project/types.ts";

export interface UnityDoctorOptions {
	homeDir?: string;
	signal?: AbortSignal | undefined;
	checkBridge?: boolean;
}

export interface UnityDoctorResult extends UnityDoctorReport {
	bridge: UnityBridgeStatus | null;
	workspaceIsUnityProject: boolean;
	projectRoot: string | null;
}

/**
 * A non-throwing diagnosis of everything that stands between a workspace and a verified Unity loop.
 * The agent gets this as a tool result; the Unity panel renders the same findings.
 */
export async function diagnoseUnityWorkspace(
	workspaceRoot: string,
	options: UnityDoctorOptions = {},
): Promise<UnityDoctorResult> {
	const findings: UnityDoctorFinding[] = [];
	const projectRoot = findUnityProjectRoot(workspaceRoot);
	if (!projectRoot) {
		findings.push({
			severity: "error",
			code: "NOT_UNITY_PROJECT",
			message:
				"No Unity project found here. Open a folder containing ProjectSettings/ProjectVersion.txt, or create a Unity project first.",
		});
		return {
			root: workspaceRoot,
			editorVersion: "unknown",
			productName: null,
			unityInstalled: false,
			editorPath: null,
			bridgeConnected: false,
			bridgeMatchesWorkspace: false,
			findings,
			bridge: null,
			workspaceIsUnityProject: false,
			projectRoot: null,
		};
	}

	let editorVersion = "unknown";
	let productName: string | null = null;
	try {
		const project = readUnityProject(projectRoot, { includeBridge: false });
		editorVersion = project.editorVersion;
		productName = project.productName;
		if (project.counts.scenes === 0) {
			findings.push({
				severity: "info",
				code: "NO_SCENES",
				message:
					"The project has no scenes yet; create one in Unity before running play-mode verification.",
			});
		}
		for (const cycle of project.assemblyGraph.cycles) {
			findings.push({
				severity: "error",
				code: "ASMDEF_CYCLE",
				message: `Assembly definitions form a cycle: ${cycle.join(" -> ")}`,
			});
		}
		for (const node of project.assemblyGraph.nodes) {
			for (const reference of node.missingReferences) {
				findings.push({
					severity: "error",
					code: "ASMDEF_MISSING_REFERENCE",
					message: `${node.name} references a missing assembly: ${reference}`,
					path: node.path,
				});
			}
		}
		if (project.warnings.length > 0) {
			for (const warning of project.warnings) {
				if (warning.startsWith("Assembly definition cycle")) continue;
				if (warning.includes("references missing assembly")) continue;
				findings.push({ severity: "warning", code: "PROJECT_WARNING", message: warning });
			}
		}
	} catch (error) {
		const message = error instanceof UnityProjectError ? error.message : String(error);
		findings.push({ severity: "error", code: "PROJECT_READ_FAILED", message });
	}

	const editorPath = findUnityInstall(editorVersion);
	if (!editorPath) {
		findings.push({
			severity: "warning",
			code: "UNITY_INSTALL_NOT_FOUND",
			message: `Could not find Unity ${editorVersion}. Install it through Unity Hub or set THINKRAIL_UNITY_EDITOR.`,
		});
	}

	const discovery = readUnityBridgeDiscovery(projectRoot, options.homeDir);
	let bridge: UnityBridgeStatus | null = null;
	let bridgeConnected = false;
	let bridgeMatchesWorkspace = false;
	if (!discovery) {
		findings.push({
			severity: "warning",
			code: "BRIDGE_NOT_RUNNING",
			message:
				"The UnityRail Unity bridge is not running. Install com.thinkrail.bridge in this project, open it in Unity, and choose Tools > UnityRail > Start Bridge.",
		});
	} else if (options.checkBridge !== false) {
		try {
			const connection = await connectUnityBridge(projectRoot, {
				...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
				...(options.signal === undefined ? {} : { signal: options.signal }),
			});
			bridge = await connection.client.status(options.signal);
			bridgeConnected = true;
			bridgeMatchesWorkspace = true;
			if (bridge.isCompiling) {
				findings.push({
					severity: "info",
					code: "UNITY_COMPILING",
					message: "Unity is compiling; wait for it to finish before trusting console output.",
				});
			}
			if (bridge.lastCompile?.state === "failed") {
				findings.push({
					severity: "error",
					code: "COMPILE_FAILED",
					message: "The last Unity compile failed. Fix the reported diagnostics before playing.",
				});
			}
		} catch (error) {
			const code = error instanceof UnityBridgeError ? error.code : "BRIDGE_UNAVAILABLE";
			const message = error instanceof Error ? error.message : String(error);
			findings.push({
				severity: code === "BRIDGE_PROJECT_MISMATCH" ? "error" : "warning",
				code,
				message,
			});
			if (error instanceof UnityBridgeError && error.code === "BRIDGE_PROJECT_MISMATCH") {
				bridgeMatchesWorkspace = false;
			}
		}
	}

	return {
		root: projectRoot,
		editorVersion,
		productName,
		unityInstalled: editorPath !== null,
		editorPath,
		bridgeConnected,
		bridgeMatchesWorkspace,
		findings,
		bridge,
		workspaceIsUnityProject: true,
		projectRoot,
	};
}
