import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export type ToolResponse =
	| { kind: "response"; value: unknown }
	| { kind: "deferred" }
	| { kind: "abandoned" };

export interface WorkspaceFiles {
	check(path: string, cwd: string): Promise<void>;
	scratchDir: string;
}

export interface ExtensionSessionServices {
	expectToolResponse(toolCallId: string): void;
	awaitToolResponse(toolCallId: string, signal: AbortSignal | undefined): Promise<ToolResponse>;
	setting(key: string): boolean;
	/** A setting declared as `{ type: "string" }`; throws when the key is unknown or is a boolean. */
	stringSetting(key: string): string;
	workspaceFiles: WorkspaceFiles;
}

export interface ExtensionBooleanSetting {
	type: "boolean";
	default: boolean;
}

export interface ExtensionStringSetting {
	type: "string";
	default: string;
}

export type ExtensionSetting = ExtensionBooleanSetting | ExtensionStringSetting;

export interface InteractiveTool {
	describeResponse?: (args: unknown, response: unknown) => string | undefined;
}

export interface ServerExtension {
	name: string;
	title?: string;
	description?: string;
	extensions: ExtensionFactory[];
	sessionExtensions?: (session: ExtensionSessionServices) => ExtensionFactory[];
	interactiveTools?: Record<string, InteractiveTool>;
	settings?: Record<string, ExtensionSetting>;
	childExtensions?: ExtensionFactory[];
	skillPackages?: string[];
}

export function defineServerExtension<T extends ServerExtension>(extension: T): T {
	return extension;
}
