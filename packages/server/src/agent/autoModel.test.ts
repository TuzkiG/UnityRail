import { expect, test } from "bun:test";
import type { Api, Message, Model } from "@earendil-works/pi-ai";
import {
	type AutoModelState,
	type AutoRouteInput,
	assessDifficulty,
	routeAutoModel,
} from "./autoModel";
import { isVirtualModel, VIRTUAL_MODEL_API } from "./modelDefaults";

interface ModelOptions {
	input?: number;
	output?: number;
	api?: string;
}

function model(id: string, provider: string, options: ModelOptions = {}): Model<Api> {
	const { input = 1, output = 1, api = `faux-${provider}` } = options;
	return {
		id,
		name: id,
		provider,
		api,
		baseUrl: "http://faux.local",
		reasoning: true,
		input: ["text"],
		cost: { input, output, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 8192,
	};
}

const opus = model("claude-opus-4-8", "anthropic", { input: 15, output: 75 });
const haiku = model("claude-haiku-4-5", "anthropic", { input: 1, output: 5 });
const auto = model("auto", "thinkrail", { api: VIRTUAL_MODEL_API });
const available = [opus, haiku, auto];

const userMessage: Message = { role: "user", content: "add a spec", timestamp: 1 };

function question(text: string): readonly Message[] {
	return [{ role: "user", content: text, timestamp: 1 }];
}

function toolResult(toolName: string, isError = false): Message {
	return {
		role: "toolResult",
		toolCallId: "call-1",
		toolName,
		content: [{ type: "text", text: "ok" }],
		isError,
		timestamp: 2,
	};
}

type RouteOverrides = Omit<Partial<AutoRouteInput>, "state" | "previous"> & {
	state?: AutoModelState | undefined;
	previous?: Model<Api> | undefined;
};

function route(overrides: RouteOverrides = {}) {
	const { state, previous, ...rest } = overrides;
	return routeAutoModel({
		reason: "user",
		thinkingLevel: "medium",
		available,
		messages: [userMessage],
		...(state ? { state } : {}),
		...(previous ? { previous } : {}),
		...rest,
	});
}

const executing: AutoModelState = {
	phase: "execute",
	plan: { provider: "anthropic", id: "claude-opus-4-8" },
	execute: { provider: "anthropic", id: "claude-haiku-4-5" },
};

test("a hard first request plans on the account's default model and executes on the cheapest", () => {
	const first = route();
	expect(first.model.id).toBe("claude-opus-4-8");
	expect(first.state).toEqual({
		phase: "plan",
		plan: { provider: "anthropic", id: "claude-opus-4-8" },
		execute: { provider: "anthropic", id: "claude-haiku-4-5" },
	});
});

test("the first successful edit hands the rest of the turn to the cheap model, once", () => {
	const planning = route().state;
	const handing = route({
		reason: "continuation",
		state: planning,
		messages: [userMessage, toolResult("edit")],
	});
	expect(handing.model.id).toBe("claude-haiku-4-5");
	expect(handing.state?.phase).toBe("execute");

	const staying = route({
		reason: "continuation",
		state: handing.state,
		messages: [userMessage, toolResult("edit"), toolResult("write")],
	});
	expect(staying.model.id).toBe("claude-haiku-4-5");
	expect(staying.state).toBeUndefined();
});

test("a failed edit does not hand off", () => {
	const decision = route({
		reason: "continuation",
		state: route().state,
		messages: [userMessage, toolResult("edit", true)],
	});
	expect(decision.model.id).toBe("claude-opus-4-8");
	expect(decision.state).toBeUndefined();
});

test("each hard user message starts a new plan phase", () => {
	const decision = route({ reason: "user", state: executing });
	expect(decision.model.id).toBe("claude-opus-4-8");
	expect(decision.state?.phase).toBe("plan");
});

test("a retry stays on the phase's model instead of cascading to another provider", () => {
	expect(route({ reason: "retry", state: executing }).model.id).toBe("claude-haiku-4-5");
});

test("requests outside the agent loop spend the cheap model", () => {
	expect(route({ reason: "direct" }).model.id).toBe("claude-haiku-4-5");
	expect(route({ reason: "direct", state: route().state }).model.id).toBe("claude-haiku-4-5");
});

test("switching an existing chat to Auto keeps its last model as the planner", () => {
	const gpt = model("gpt-6.1-sol", "openai", { input: 10, output: 40 });
	const decision = route({ available: [...available, gpt], previous: gpt });
	expect(decision.model.id).toBe("gpt-6.1-sol");
	expect(decision.state?.execute.id).toBe("claude-haiku-4-5");
});

test("a planner that leaves the catalog re-derives instead of failing", () => {
	const decision = route({
		state: { ...executing, phase: "plan", plan: { provider: "anthropic", id: "claude-opus-4-0" } },
	});
	expect(decision.model.id).toBe("claude-opus-4-8");
});

test("the configured Auto models and effort win over the automatic picks", () => {
	const flash = model("deepseek-flash", "deepseek", { input: 0.3, output: 1.2 });
	const pro = model("deepseek-v4-pro", "deepseek", { input: 1.3, output: 4 });
	const available = [opus, haiku, flash, pro];
	const preferences = {
		plan: { provider: "deepseek", id: "deepseek-v4-pro" },
		execute: { provider: "deepseek", id: "deepseek-flash" },
		effort: "high" as const,
	};

	const planned = route({ available, preferences });
	expect(planned.model.id).toBe("deepseek-v4-pro");
	expect(planned.thinkingLevel).toBe("high");
	expect(planned.state?.execute).toEqual({ provider: "deepseek", id: "deepseek-flash" });

	const executing = route({
		reason: "continuation",
		available,
		preferences,
		state: planned.state,
		messages: [userMessage, toolResult("edit")],
	});
	expect(executing.model.id).toBe("deepseek-flash");
	expect(executing.thinkingLevel).toBe("high");
});

test("an Auto preference that left the catalog falls back to the automatic pick", () => {
	const stale = {
		plan: { provider: "deepseek", id: "deepseek-v3" },
		execute: { provider: "deepseek", id: "deepseek-v3" },
	};
	const decision = route({ preferences: stale });
	expect(decision.model.id).toBe("claude-opus-4-8");
	expect(decision.state?.execute.id).toBe("claude-haiku-4-5");
});

test("the router never routes to itself", () => {
	expect(isVirtualModel(auto)).toBe(true);
	expect(isVirtualModel(opus)).toBe(false);
	expect(() => route({ available: [auto] })).toThrow("no available model");
});

test("a lone model plans and executes on itself", () => {
	const decision = route({ available: [opus] });
	expect(decision.model.id).toBe("claude-opus-4-8");
	expect(decision.state?.execute.id).toBe("claude-opus-4-8");
});

test("an easy turn is answered by the cheap model alone, edits included", () => {
	const asking = route({ messages: question("What does the settle gate do?") });
	expect(asking.model.id).toBe("claude-haiku-4-5");
	expect(asking.state?.phase).toBe("execute");

	const continuing = route({
		reason: "continuation",
		state: asking.state,
		messages: [...question("What does the settle gate do?"), toolResult("edit")],
	});
	expect(continuing.model.id).toBe("claude-haiku-4-5");
});

test("difficulty reads the latest message: short questions are easy, work is not", () => {
	expect(assessDifficulty(question("what does agent_settled mean?"))).toBe("easy");
	expect(assessDifficulty(question("为什么这里要等 settle？"))).toBe("easy");
	expect(assessDifficulty(question("Explain the settle gate"))).toBe("easy");
	expect(assessDifficulty(question("解释一下 settle gate"))).toBe("easy");
	expect(assessDifficulty(question("what does this do?\n```ts\nsettle()\n```"))).toBe("hard");
	expect(assessDifficulty(question("why does src/agent/oneshot.ts pick haiku?"))).toBe("hard");
	expect(assessDifficulty(question("what is this error: TS2304?"))).toBe("hard");
	expect(assessDifficulty(question("add a spec for the router"))).toBe("hard");
	expect(assessDifficulty(question("修复这个报错"))).toBe("hard");
	expect(assessDifficulty(question("what? ".repeat(80)))).toBe("hard");
	expect(assessDifficulty([])).toBe("hard");
});
