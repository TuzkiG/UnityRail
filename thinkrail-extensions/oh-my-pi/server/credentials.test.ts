import { describe, expect, it } from "bun:test";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
	apiKeyFor,
	completeWithRotation,
	isRotationError,
	markApiKeyBad,
	parseApiKeys,
} from "./credentials.ts";

const model = { provider: "anthropic", id: "sonnet" } as never;

describe("parseApiKeys", () => {
	it("parses one provider/model per line with pipe or comma separated keys", () => {
		const pool = parseApiKeys(
			"# comment\nanthropic/sonnet = k1 | k2\nopenai/gpt-4o=k3,k4\nbroken\n",
		);
		expect(pool.keys.get("anthropic/sonnet")).toEqual(["k1", "k2"]);
		expect(pool.keys.get("openai/gpt-4o")).toEqual(["k3", "k4"]);
		expect(pool.keys.size).toBe(2);
	});

	it("deduplicates repeated keys", () => {
		const pool = parseApiKeys("anthropic/sonnet=k1|k1|k2");
		expect(pool.keys.get("anthropic/sonnet")).toEqual(["k1", "k2"]);
	});
});

describe("key rotation", () => {
	it("returns the first healthy key and skips marked ones", () => {
		const pool = parseApiKeys("anthropic/sonnet=k1|k2");
		expect(apiKeyFor(pool, model)).toBe("k1");
		markApiKeyBad(pool, model, "k1");
		expect(apiKeyFor(pool, model)).toBe("k2");
		markApiKeyBad(pool, model, "k2");
		expect(apiKeyFor(pool, model)).toBeUndefined();
	});

	it("recognizes 401/429 only", () => {
		expect(isRotationError({ status: 401 })).toBe(true);
		expect(isRotationError({ statusCode: 429 })).toBe(true);
		expect(isRotationError(new Error("429 Too Many Requests"))).toBe(true);
		expect(isRotationError(new Error("500 boom"))).toBe(false);
	});
});

describe("completeWithRotation", () => {
	it("retries with the next key after an auth failure", async () => {
		const pool = parseApiKeys("anthropic/sonnet=k1|k2");
		const seen: (string | undefined)[] = [];
		const registry = {
			complete: async (_model: unknown, _context: unknown, options?: { apiKey?: string }) => {
				seen.push(options?.apiKey);
				if (seen.length === 1) throw Object.assign(new Error("unauthorized"), { status: 401 });
				return { content: [{ type: "text", text: "done" }] };
			},
		} as unknown as ModelRegistry;
		const reply = await completeWithRotation(
			registry,
			pool,
			model,
			{ messages: [] },
			{ maxTokens: 10 },
		);
		expect(seen).toEqual(["k1", "k2"]);
		expect(apiKeyFor(pool, model)).toBe("k2");
		expect(reply.content[0]).toEqual({ type: "text", text: "done" });
	});

	it("throws for other failures without rotating", async () => {
		const pool = parseApiKeys("anthropic/sonnet=k1|k2");
		const registry = {
			complete: async () => {
				throw new Error("500 boom");
			},
		} as unknown as ModelRegistry;
		await expect(completeWithRotation(registry, pool, model, { messages: [] }, {})).rejects.toThrow(
			"500 boom",
		);
	});
});
