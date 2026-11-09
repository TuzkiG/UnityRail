import { describe, expect, it } from "bun:test";
import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@earendil-works/pi-coding-agent";
import { registerAdvisor, resolveAdvisorModel, summarizeTurn } from "./advisor.ts";

const model = { provider: "anthropic", id: "claude" } as never;

function turn(text: string, toolTexts: string[] = []): TurnEndEvent {
	return {
		type: "turn_end",
		turnIndex: 0,
		message: {
			role: "assistant",
			content: text ? [{ type: "text", text }] : [],
		},
		toolResults: toolTexts.map((toolText) => ({
			role: "toolResult",
			toolCallId: "call",
			toolName: "bash",
			content: [{ type: "text", text: toolText }],
			isError: false,
			timestamp: 0,
		})),
	} as unknown as TurnEndEvent;
}

function harness(options: { advice?: string; fail?: boolean; found?: boolean } = {}) {
	const calls: unknown[] = [];
	const handlers = new Map<string, (event: TurnEndEvent, ctx: ExtensionContext) => unknown>();
	const pi = {
		on: (name: string, handler: (event: TurnEndEvent, ctx: ExtensionContext) => unknown) => {
			handlers.set(name, handler);
		},
	} as unknown as Pick<ExtensionAPI, "on">;
	const ctx = {
		model,
		modelRegistry: {
			find: () => (options.found === false ? undefined : model),
			complete: async (...args: unknown[]) => {
				calls.push(args);
				if (options.fail) throw new Error("provider down");
				return { content: [{ type: "text", text: options.advice ?? "Check the tests." }] };
			},
		},
	} as unknown as ExtensionContext;
	return { calls, ctx, handlers, pi };
}

describe("summarizeTurn", () => {
	it("includes the assistant text and tool output", () => {
		expect(summarizeTurn(turn("Editing.", ["ok"]))).toBe("Assistant:\nEditing.\n\nTool bash:\nok");
	});

	it("returns an empty string when the turn has nothing to read", () => {
		expect(summarizeTurn(turn(""))).toBe("");
	});
});

describe("resolveAdvisorModel", () => {
	it("falls back to the session model when no reference is configured", () => {
		const { ctx } = harness();
		expect(resolveAdvisorModel(ctx, "")).toBe(model);
		expect(resolveAdvisorModel(ctx, "without-a-slash")).toBeUndefined();
	});
});

describe("registerAdvisor", () => {
	it("injects the advice as a custom message", async () => {
		const { calls, ctx, handlers, pi } = harness();
		registerAdvisor(pi as ExtensionAPI, { modelRef: "" });
		const result = (await handlers.get("turn_end")?.(turn("Editing.", ["ok"]), ctx)) as {
			entries: { customType: string; content: string; display: boolean }[];
		};
		expect(result.entries[0]).toMatchObject({
			customType: "oh-my-pi-advisor",
			content: "Check the tests.",
			display: true,
		});
		expect(calls).toHaveLength(1);
	});

	it("skips empty turns, OK advice and a missing model", async () => {
		const empty = harness();
		registerAdvisor(empty.pi as ExtensionAPI, { modelRef: "" });
		expect(await empty.handlers.get("turn_end")?.(turn(""), empty.ctx)).toBeUndefined();

		const ok = harness({ advice: "OK" });
		registerAdvisor(ok.pi as ExtensionAPI, { modelRef: "" });
		expect(await ok.handlers.get("turn_end")?.(turn("Editing."), ok.ctx)).toBeUndefined();

		const missing = harness({ found: false });
		const warnings: string[] = [];
		registerAdvisor(missing.pi as ExtensionAPI, {
			modelRef: "nope/model",
			onWarn: (message) => warnings.push(message),
		});
		expect(await missing.handlers.get("turn_end")?.(turn("Editing."), missing.ctx)).toBeUndefined();
		expect(await missing.handlers.get("turn_end")?.(turn("Editing."), missing.ctx)).toBeUndefined();
		expect(warnings).toHaveLength(1);
		expect(missing.calls).toHaveLength(0);
	});

	it("caps the number of advisor calls per session", async () => {
		const { calls, ctx, handlers, pi } = harness();
		registerAdvisor(pi as ExtensionAPI, { modelRef: "", maxCalls: 2 });
		const handler = handlers.get("turn_end");
		await handler?.(turn("one"), ctx);
		await handler?.(turn("two"), ctx);
		await handler?.(turn("three"), ctx);
		expect(calls).toHaveLength(2);
	});

	it("warns instead of throwing when the model call fails", async () => {
		const { ctx, handlers, pi } = harness({ fail: true });
		const warnings: string[] = [];
		registerAdvisor(pi as ExtensionAPI, {
			modelRef: "",
			onWarn: (message) => warnings.push(message),
		});
		expect(await handlers.get("turn_end")?.(turn("Editing."), ctx)).toBeUndefined();
		expect(warnings[0]).toContain("provider down");
	});
});
