import type { ExtensionSetting } from "@thinkrail/extension-api/server";
import { defineServerExtension } from "@thinkrail/extension-api/server";
import { MEMORY_EXTENSION, MEMORY_STRINGS, MEMORY_TOGGLES } from "../shared/keys.ts";
import { registerMemoryAdapter } from "./adapter.ts";
import { readMemoryOptions } from "./options.ts";

const settings: Record<string, ExtensionSetting> = {};
for (const [key, value] of Object.entries(MEMORY_TOGGLES)) {
	settings[key] = { type: "boolean", default: value };
}
for (const [key, value] of Object.entries(MEMORY_STRINGS)) {
	settings[key] = { type: "string", default: value };
}

export default defineServerExtension({
	name: MEMORY_EXTENSION,
	title: "Memory",
	description:
		"Persistent memory for the agent: a local-first store that survives sessions and compactions, served by the Memory engine over HTTP.",
	extensions: [],
	settings,
	sessionExtensions: (session) => {
		const options = readMemoryOptions(session);
		if (!options.enabled) return [];
		return [(pi) => registerMemoryAdapter(pi, options)];
	},
});
