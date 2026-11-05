import { spawn } from "node:child_process";
import { UnityBridgeError } from "./bridge/client.ts";
import { findUnityInstall, readUnityProject } from "./project/project.ts";

export interface OpenUnityProjectOptions {
	editorPath?: string;
	extraArgs?: string[];
}

export interface OpenUnityProjectResult {
	started: boolean;
	editorPath: string;
	pid: number | null;
}

/**
 * Launch the Unity Editor for a project. The host's "Open in Unity" action uses this when the bridge
 * reports a different project; the agent never needs to guess an install path.
 */
export function openUnityProject(
	projectRoot: string,
	options: OpenUnityProjectOptions = {},
): OpenUnityProjectResult {
	const project = readUnityProject(projectRoot, { includeBridge: false });
	const editorPath = options.editorPath ?? findUnityInstall(project.editorVersion);
	if (!editorPath) {
		throw new UnityBridgeError(
			"UNITY_INSTALL_NOT_FOUND",
			`Could not find Unity ${project.editorVersion}. Install it through Unity Hub or set THINKRAIL_UNITY_EDITOR.`,
		);
	}
	const child = spawn(editorPath, ["-projectPath", projectRoot, ...(options.extraArgs ?? [])], {
		detached: true,
		stdio: "ignore",
		windowsHide: false,
	});
	// A detached child's spawn failure would otherwise surface as an unhandled 'error' event and take
	// the host down; the panel reports the missing editor through the next bridge/status read instead.
	child.on("error", () => {});
	child.unref();
	return { started: true, editorPath, pid: child.pid ?? null };
}
