import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineServerExtension } from "@thinkrail/extension-api/server";
import { registerUnityBridgeTools } from "./bridge.ts";
import { registerUnityContext } from "./context.ts";
import { registerUnityProjectTools } from "./project.ts";
import { registerUnitySceneTools } from "./scene.ts";
import { registerUnityEditorTools } from "./tools.ts";

function registerUnityExtension(pi: ExtensionAPI): void {
	registerUnityProjectTools(pi);
	registerUnityBridgeTools(pi);
	registerUnitySceneTools(pi);
	registerUnityEditorTools(pi);
	registerUnityContext(pi);
}

export default defineServerExtension({
	name: "unity",
	title: "Unity",
	description:
		"Connects the agent to the Unity Editor: project model, compile diagnostics, Console, Play Mode, Game View screenshots, tests, hierarchy, inspection, asset search, and the project's own [BridgeTool] Editor tools.",
	extensions: [registerUnityExtension],
	skillPackages: ["@thinkrail/pi-unity-skills"],
});
