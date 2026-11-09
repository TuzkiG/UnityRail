import { parseToolResultContent } from "./toolResultContent";

export function resultText(result: unknown): string {
	return parseToolResultContent(result).text;
}

export function strArg(args: Record<string, unknown>, key: string): string {
	const v = args[key];
	return typeof v === "string" ? v : "";
}

export function numArg(args: Record<string, unknown>, key: string): number | null {
	const v = args[key];
	return typeof v === "number" ? v : null;
}
