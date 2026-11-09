import type { ExtensionSessionServices } from "@thinkrail/extension-api/server";

export interface OhMyPiOptions {
	advisor: boolean;
	advisorModel: string;
	apiKeys: string;
	hashline: boolean;
	lspCommands: string;
	lspDiagnostics: boolean;
	modelRouting: boolean;
	routerDefault: string;
	routerFallback: string;
	routerFast: string;
	rules: boolean;
	rulesDir: string;
	structuredResults: boolean;
}

/** Reads the extension's stored settings for one session; later sessions see later edits. */
export function readOhMyPiOptions(session: ExtensionSessionServices): OhMyPiOptions {
	return {
		advisor: session.setting("advisor"),
		advisorModel: session.stringSetting("advisorModel"),
		apiKeys: session.stringSetting("apiKeys"),
		hashline: session.setting("hashline"),
		lspCommands: session.stringSetting("lspCommands"),
		lspDiagnostics: session.setting("lspDiagnostics"),
		modelRouting: session.setting("modelRouting"),
		routerDefault: session.stringSetting("routerDefault"),
		routerFallback: session.stringSetting("routerFallback"),
		routerFast: session.stringSetting("routerFast"),
		rules: session.setting("rules"),
		rulesDir: session.stringSetting("rulesDir"),
		structuredResults: session.setting("structuredResults"),
	};
}
