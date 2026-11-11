import type { ExtensionSessionServices } from "@thinkrail/extension-api/server";

export interface MemoryOptions {
	enabled: boolean;
	memoryBin: string;
	memoryPort: string;
	memoryUrl: string;
}

/** Reads the extension's stored settings for one session; later sessions see later edits. */
export function readMemoryOptions(session: ExtensionSessionServices): MemoryOptions {
	return {
		enabled: session.setting("enabled"),
		memoryBin: session.stringSetting("memoryBin"),
		memoryPort: session.stringSetting("memoryPort"),
		memoryUrl: session.stringSetting("memoryUrl"),
	};
}
