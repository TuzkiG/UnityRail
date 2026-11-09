import type { JsonValue } from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";

export interface StructuredResult {
	text: string;
	structured?: JsonValue;
}

export function stripJsonFence(text: string): string {
	const trimmed = text.trim();
	const fenced = trimmed.match(/^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i);
	return fenced?.[1]?.trim() ?? trimmed;
}

export function structureResult(
	schema: TSchema | undefined,
	finalText: string | undefined,
	fallback: string,
): StructuredResult {
	if (schema === undefined || finalText === undefined || finalText.trim() === "")
		return { text: fallback };
	let value: unknown;
	try {
		value = JSON.parse(stripJsonFence(finalText));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { text: `Result does not match resultSchema: ${message}\n\n${fallback}` };
	}
	if (Value.Check(schema, value)) {
		return { text: JSON.stringify(value, null, 2), structured: value as JsonValue };
	}
	const errors = Value.Errors(schema, value)
		.slice(0, 5)
		.map((detail) => `- ${detail.instancePath || "/"}: ${detail.message}`);
	return {
		text: `Result does not match resultSchema:\n${errors.join("\n")}\n\n${fallback}`,
	};
}
