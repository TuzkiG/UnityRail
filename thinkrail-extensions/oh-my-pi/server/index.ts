import type { ExtensionSetting } from "@thinkrail/extension-api/server";
import { defineServerExtension } from "@thinkrail/extension-api/server";
import { OH_MY_PI_EXTENSION, OH_MY_PI_STRINGS, OH_MY_PI_TOGGLES } from "../shared/keys.ts";
import { registerAdvisor } from "./advisor.ts";
import { parseApiKeys } from "./credentials.ts";
import { createHashlineEditTool, createHashlineReadTool } from "./hashline.ts";
import { parseLspCommands, registerLspDiagnostics } from "./lsp.ts";
import { readOhMyPiOptions } from "./options.ts";
import { registerAutoRouter, splitRefs } from "./routing.ts";
import { registerRules } from "./rules.ts";

const settings: Record<string, ExtensionSetting> = {};
for (const [key, value] of Object.entries(OH_MY_PI_TOGGLES)) {
	settings[key] = { type: "boolean", default: value };
}
for (const [key, value] of Object.entries(OH_MY_PI_STRINGS)) {
	settings[key] = { type: "string", default: value };
}

export default defineServerExtension({
	name: OH_MY_PI_EXTENSION,
	title: "Oh my pi",
	description: "LSP diagnostics, hash-anchored edits, an advisor model, model routing and rules.",
	extensions: [],
	settings,
	sessionExtensions: (session) => [
		(pi) => {
			const options = readOhMyPiOptions(session);
			const apiKeys = parseApiKeys(options.apiKeys);
			if (options.hashline) {
				pi.registerTool(createHashlineEditTool(process.cwd()));
				pi.registerTool(createHashlineReadTool(process.cwd()));
			}
			if (options.rules) registerRules(pi, options.rulesDir);
			if (options.advisor) {
				registerAdvisor(pi, {
					modelRef: options.advisorModel,
					apiKeys,
					onWarn: (message) => console.warn(message),
				});
			}
			if (options.modelRouting) {
				registerAutoRouter(pi, {
					defaultRef: options.routerDefault,
					fastRef: options.routerFast,
					fallbackRefs: splitRefs(options.routerFallback),
				});
			}
			if (options.lspDiagnostics) {
				registerLspDiagnostics(pi, {
					root: process.cwd(),
					commands: parseLspCommands(options.lspCommands),
				});
			}
		},
	],
});
