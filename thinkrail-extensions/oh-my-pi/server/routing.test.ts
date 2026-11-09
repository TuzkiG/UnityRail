import { describe, expect, it } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { pickRouteModel, type RouterSettings, splitRefs } from "./routing.ts";

type Model = NonNullable<ReturnType<typeof pickRouteModel>>;
const session = { provider: "session", id: "model" } as unknown as Model;
const physical: Record<string, Model> = {
	"anthropic/sonnet": { provider: "anthropic", id: "sonnet" },
	"openai/fast": { provider: "openai", id: "fast" },
	"openai/backup": { provider: "openai", id: "backup" },
} as unknown as Record<string, Model>;

function ctx(): ExtensionContext {
	return {
		model: session,
		modelRegistry: {
			find: (provider: string, id: string) => physical[`${provider}/${id}`],
		},
	} as unknown as ExtensionContext;
}

type Request = Parameters<typeof pickRouteModel>[2];

function request(patch: Partial<Record<keyof Request, unknown>>): Request {
	return { reason: "user", thinkingLevel: "medium", messages: [], ...patch } as unknown as Request;
}

const settings: RouterSettings = {
	defaultRef: "anthropic/sonnet",
	fastRef: "openai/fast",
	fallbackRefs: ["openai/backup", "anthropic/sonnet"],
};

describe("splitRefs", () => {
	it("accepts commas and newlines, dropping blanks", () => {
		expect(splitRefs(" a/b , c/d\n\n e/f ")).toEqual(["a/b", "c/d", "e/f"]);
	});
});

describe("pickRouteModel", () => {
	it("routes user turns to the default and direct turns to the fast model", () => {
		expect(pickRouteModel(ctx(), settings, request({}))).toEqual(physical["anthropic/sonnet"]);
		expect(pickRouteModel(ctx(), settings, request({ reason: "direct" }))).toEqual(
			physical["openai/fast"],
		);
	});

	it("keeps the previous model on continuation", () => {
		const previous = { model: physical["openai/backup"] };
		expect(pickRouteModel(ctx(), settings, request({ reason: "continuation", previous }))).toEqual(
			previous.model,
		);
	});

	it("walks the fallback chain on retries and falls back to the previous model", () => {
		const previous = { model: physical["openai/fast"] };
		expect(pickRouteModel(ctx(), settings, request({ reason: "retry", previous }))).toEqual(
			physical["openai/backup"],
		);
		expect(
			pickRouteModel(
				ctx(),
				settings,
				request({ reason: "retry", previous, state: { attempt: 1 } }),
			),
		).toEqual(physical["anthropic/sonnet"]);
		expect(
			pickRouteModel(
				ctx(),
				settings,
				request({ reason: "retry", previous, state: { attempt: 5 } }),
			),
		).toEqual(previous.model);
	});

	it("uses the session model when nothing configured resolves", () => {
		const empty: RouterSettings = { defaultRef: "nope/x", fastRef: "nope/y", fallbackRefs: [] };
		expect(pickRouteModel(ctx(), empty, request({}))).toEqual(session);
	});
});
