import { describe, expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import type { SessionPolicy } from "@thinkrail/contracts";
import {
	createSessionPolicyExtension,
	POLICY_CONFIRM_CHAT,
	POLICY_CONFIRM_DENY,
	POLICY_CONFIRM_ONCE,
} from "./sessionPolicy.ts";

type Handler = (
	event: ToolCallEvent,
	ctx: ExtensionContext,
) => Promise<ToolCallEventResult | undefined>;

function guard(policy: SessionPolicy, answer: string | undefined = undefined) {
	const asked: Array<{ title: string; options: string[] }> = [];
	let handler: Handler | undefined;
	const pi = {
		on: (name: string, next: Handler) => {
			if (name === "tool_call") handler = next;
		},
	} as unknown as ExtensionAPI;
	const extension = createSessionPolicyExtension({
		policy: () => policy,
		askForToolCall: async (_id, _input, title, options) => {
			asked.push({ title, options });
			return answer;
		},
	});
	if (typeof extension === "function") extension(pi);
	else extension.factory(pi);
	if (!handler) throw new Error("tool_call was not registered");
	return { run: handler, asked };
}

function call(toolName: string, input: Record<string, unknown> = {}): ToolCallEvent {
	return { toolName, toolCallId: "call-1", input } as unknown as ToolCallEvent;
}

function ctx(hasUI = true): ExtensionContext {
	return { hasUI, signal: undefined } as unknown as ExtensionContext;
}

describe("the session policy guard", () => {
	test("default + full auto runs mutating tools without asking", async () => {
		const { run, asked } = guard({ collaboration: "default", approval: "full-auto" });
		expect(await run(call("bash", { command: "ls" }), ctx())).toBeUndefined();
		expect(await run(call("edit", { path: "a.ts" }), ctx())).toBeUndefined();
		expect(asked).toHaveLength(0);
	});

	test("request asks before a shell command and honours each answer", async () => {
		const once = guard({ collaboration: "default", approval: "request" }, POLICY_CONFIRM_ONCE);
		expect(await once.run(call("bash", { command: "bun test" }), ctx())).toBeUndefined();
		expect(once.asked).toHaveLength(1);
		expect(once.asked[0]?.options).toContain(POLICY_CONFIRM_DENY);
		expect(once.asked[0]?.title).toContain("bun test");

		const denied = guard({ collaboration: "default", approval: "request" }, POLICY_CONFIRM_DENY);
		const blocked = await denied.run(call("bash", { command: "rm -rf dist" }), ctx());
		expect(blocked?.block).toBe(true);
		expect(blocked?.reason).toContain("denied");
	});

	test("allowing the chat stops the questions for that tool", async () => {
		const { run, asked } = guard(
			{ collaboration: "default", approval: "request" },
			POLICY_CONFIRM_CHAT,
		);
		expect(await run(call("bash", { command: "ls" }), ctx())).toBeUndefined();
		expect(await run(call("bash", { command: "ls -la" }), ctx())).toBeUndefined();
		expect(asked).toHaveLength(1);
	});

	test("request does not ask before a file edit", async () => {
		const { run, asked } = guard(
			{ collaboration: "default", approval: "request" },
			POLICY_CONFIRM_DENY,
		);
		expect(await run(call("write", { path: "a.ts", content: "" }), ctx())).toBeUndefined();
		expect(asked).toHaveLength(0);
	});

	test("ask mode refuses writes, commands, delegation and Unity writes without asking", async () => {
		const { run, asked } = guard(
			{ collaboration: "ask", approval: "request" },
			POLICY_CONFIRM_ONCE,
		);
		for (const toolName of [
			"edit",
			"write",
			"bash",
			"background_command",
			"Agent",
			"unity_edit_scene",
			"unity_project_action",
		]) {
			const result = await run(call(toolName), ctx());
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("Ask mode");
		}
		expect(await run(call("read", { path: "a.ts" }), ctx())).toBeUndefined();
		expect(asked).toHaveLength(0);
	});

	test("plan mode refuses writes with plan wording", async () => {
		const { run } = guard({ collaboration: "plan", approval: "full-auto" });
		const result = await run(call("write", { path: "a.ts", content: "" }), ctx());
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("Plan mode");
	});

	test("a command that needs confirmation is refused when no UI is attached", async () => {
		const { run, asked } = guard(
			{ collaboration: "default", approval: "request" },
			POLICY_CONFIRM_ONCE,
		);
		const result = await run(call("bash", { command: "ls" }), ctx(false));
		expect(result?.block).toBe(true);
		expect(asked).toHaveLength(0);
	});

	test("dismissing the question keeps the command blocked", async () => {
		const { run } = guard({ collaboration: "default", approval: "request" }, undefined);
		const result = await run(call("bash", { command: "ls" }), ctx());
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("did not confirm");
	});
});
