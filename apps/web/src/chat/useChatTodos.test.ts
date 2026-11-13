import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import type { PiEvent, TodoItem, TodoPlan } from "@thinkrail/contracts";
import { PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { act, createElement, Fragment, useEffect } from "react";
import { createRoot } from "react-dom/client";

type ReadParams = { workspaceId: string; sessionId: string; opened?: "page" | "rail" };
type PendingRead = {
	params: ReadParams;
	resolve: (plan: TodoPlan) => void;
	reject: (error: unknown) => void;
};
const pendingReads: PendingRead[] = [];
const actualTransport = await import("../transport");
mock.module("../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: (method: string, params: ReadParams) => {
			if (method !== "todo.list") {
				return Promise.reject(new Error(`unexpected request ${method}`));
			}
			return new Promise<TodoPlan>((resolve, reject) => {
				pendingReads.push({ params, resolve, reject });
			});
		},
		subscribe: () => () => {},
	}),
}));

const { supportsPlanSummaryGeneration } = actualTransport;
const { useAppStore } = await import("../store");
const {
	planIsCompleteWithoutSummary,
	requestTodoList,
	shouldRefreshTodos,
	signalTodoRefetch,
	subscribeTodoRefetch,
	useChatTodos,
} = await import("./useChatTodos");

const item = (status: TodoItem["status"]): TodoItem => ({
	id: `t_${status}_${Math.random()}`,
	title: "step",
	status,
	origin: "agent",
	createdAt: "",
	updatedAt: "",
});
const plan = (over: Partial<TodoPlan>): TodoPlan => ({ todos: [], groups: [], ...over });
const readsFor = (sessionId: string) =>
	pendingReads.filter((read) => read.params.sessionId === sessionId);

type ReactGlobals = { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined; window?: unknown };
const globals = globalThis as ReactGlobals;
const saved = { act: globals.IS_REACT_ACT_ENVIRONMENT, window: globals.window };

// react-dom only touches these members when a tree renders no host elements.
beforeAll(() => {
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.window = {
		event: undefined,
		HTMLIFrameElement: class {},
		document: { activeElement: null },
	};
});
afterAll(() => {
	globals.IS_REACT_ACT_ENVIRONMENT = saved.act;
	globals.window = saved.window;
});

function headlessContainer() {
	const noop = () => {};
	return {
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		textContent: "",
		addEventListener: noop,
		removeEventListener: noop,
		ownerDocument: { nodeType: 9, addEventListener: noop, removeEventListener: noop },
	} as unknown as Element;
}

test("TODO refreshes follow tool completion and final settlement, not attempt-level agent_end", () => {
	expect(shouldRefreshTodos({ type: "tool_execution_end" } as PiEvent)).toBe(true);
	expect(shouldRefreshTodos({ type: "agent_settled", terminal: null })).toBe(true);
	expect(shouldRefreshTodos({ type: "agent_end", messages: [], willRetry: false } as PiEvent)).toBe(
		false,
	);
});

test("auto-summary is eligible only when every step is done and no summary exists", () => {
	expect(planIsCompleteWithoutSummary(plan({ todos: [item("done")] }))).toBe(true);
	expect(
		planIsCompleteWithoutSummary(
			plan({
				groups: [{ id: "g", title: "T", status: "done", todos: [item("done"), item("done")] }],
			}),
		),
	).toBe(true);
	// An open step, a lingering summary, or an empty plan are all ineligible.
	expect(planIsCompleteWithoutSummary(plan({ todos: [item("done"), item("pending")] }))).toBe(
		false,
	);
	expect(planIsCompleteWithoutSummary(plan({ todos: [item("done")], summary: "already" }))).toBe(
		false,
	);
	expect(planIsCompleteWithoutSummary(plan({}))).toBe(false);
});

test("a completed plan requests a draft only from a host that advertises the v69 capability", () => {
	const completed = plan({ todos: [item("done")] });
	const wouldRequest = (pv: number | null) =>
		planIsCompleteWithoutSummary(completed) && supportsPlanSummaryGeneration(pv);
	expect(wouldRequest(PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION)).toBe(true);
	expect(wouldRequest(PLAN_SUMMARY_GENERATION_PROTOCOL_VERSION - 1)).toBe(false);
	expect(wouldRequest(null)).toBe(false);
});

test("the refetch bus fans out to every subscriber for a chat key and isolates sibling chats", () => {
	const calls: string[] = [];
	const railA = () => calls.push("rail:A");
	const pageA = () => calls.push("page:A");
	const railB = () => calls.push("rail:B");
	const unsubscribeRailA = subscribeTodoRefetch("A", railA);
	const unsubscribePageA = subscribeTodoRefetch("A", pageA);
	const unsubscribeRailB = subscribeTodoRefetch("B", railB);

	signalTodoRefetch("A");
	expect(calls.sort()).toEqual(["page:A", "rail:A"]);

	calls.length = 0;
	signalTodoRefetch("B");
	expect(calls).toEqual(["rail:B"]);

	calls.length = 0;
	unsubscribePageA();
	signalTodoRefetch("A");
	expect(calls).toEqual(["rail:A"]);

	unsubscribeRailA();
	unsubscribeRailB();
	calls.length = 0;
	signalTodoRefetch("A");
	signalTodoRefetch("B");
	expect(calls).toEqual([]);
});

test("an unknown key signal is a no-op — safe to fire before any subscriber mounts", () => {
	expect(() => signalTodoRefetch("never-subscribed")).not.toThrow();
});

test("a listener added mid-signal does NOT run for the signal that was already in flight", () => {
	const calls: string[] = [];
	const late: (() => void)[] = [];
	const early = () => {
		calls.push("early");
		late.push(subscribeTodoRefetch("K", () => calls.push("late")));
	};
	const unsubscribeEarly = subscribeTodoRefetch("K", early);
	signalTodoRefetch("K");
	expect(calls).toEqual(["early"]);

	calls.length = 0;
	signalTodoRefetch("K");
	expect(calls.sort()).toEqual(["early", "late"]);

	unsubscribeEarly();
	for (const u of late) u();
});

test("the same listener subscribed twice is only invoked once per signal (Set-based bus)", () => {
	let calls = 0;
	const listener = () => {
		calls += 1;
	};
	const a = subscribeTodoRefetch("K2", listener);
	const b = subscribeTodoRefetch("K2", listener);
	signalTodoRefetch("K2");
	expect(calls).toBe(1);
	a();
	b();
});

test("an unsubscribe cleans up the key's bucket — later signals cost nothing and don't fire stale closures", () => {
	const sink: string[] = [];
	const drop = subscribeTodoRefetch("K3", () => sink.push("x"));
	drop();
	signalTodoRefetch("K3");
	signalTodoRefetch("K3");
	expect(sink).toEqual([]);
	expect(() => drop()).not.toThrow();
});

test("one listener's throw does not swallow its siblings' signal — the bus keeps delivering", () => {
	const survivors: string[] = [];
	const a = subscribeTodoRefetch("K4", () => {
		throw new Error("first listener blew up");
	});
	const b = subscribeTodoRefetch("K4", () => survivors.push("b"));
	const originalError = console.error;
	console.error = () => {};
	try {
		expect(() => signalTodoRefetch("K4")).not.toThrow();
		expect(survivors).toEqual(["b"]);
	} finally {
		console.error = originalError;
	}
	a();
	b();
});

test("concurrent todo.list reads for one session share one in-flight request", async () => {
	const first = requestTodoList("ws-share", "s-share");
	const second = requestTodoList("ws-share", "s-share");
	const reads = readsFor("s-share");
	expect(reads).toHaveLength(1);
	expect(second).toBe(first);

	const value = plan({ todos: [item("done")] });
	reads[0]?.resolve(value);
	expect(await first).toEqual(value);
	expect(await second).toEqual(value);

	// The entry clears once the flight settles, so the next read starts a fresh request.
	const retry = requestTodoList("ws-share", "s-share");
	expect(readsFor("s-share")).toHaveLength(2);
	readsFor("s-share")[1]?.resolve(plan({}));
	await retry;
});

test("an opened marker rides only the read that starts a flight", async () => {
	const rail = requestTodoList("ws-open", "s-open", "rail");
	const shared = requestTodoList("ws-open", "s-open");
	expect(readsFor("s-open")).toHaveLength(1);
	expect(readsFor("s-open")[0]?.params).toEqual({
		workspaceId: "ws-open",
		sessionId: "s-open",
		opened: "rail",
	});
	readsFor("s-open")[0]?.resolve(plan({}));
	await Promise.all([rail, shared]);

	// A joiner never adds its own marker to the request already in flight.
	const plain = requestTodoList("ws-open", "s-open");
	const joinedRail = requestTodoList("ws-open", "s-open", "rail");
	expect(readsFor("s-open")).toHaveLength(2);
	expect(readsFor("s-open")[1]?.params).toEqual({
		workspaceId: "ws-open",
		sessionId: "s-open",
	});
	readsFor("s-open")[1]?.resolve(plan({}));
	await Promise.all([plain, joinedRail]);

	const page = requestTodoList("ws-open", "s-open", "page");
	expect(readsFor("s-open")[2]?.params).toEqual({
		workspaceId: "ws-open",
		sessionId: "s-open",
		opened: "page",
	});
	readsFor("s-open")[2]?.resolve(plan({}));
	await page;
});

test("flights are isolated by workspace and session", async () => {
	const a = requestTodoList("ws-iso-a", "s-iso");
	const b = requestTodoList("ws-iso-a", "s-iso-other");
	const c = requestTodoList("ws-iso-b", "s-iso");
	expect(readsFor("s-iso")).toHaveLength(2);
	expect(readsFor("s-iso-other")).toHaveLength(1);
	for (const read of pendingReads) read.resolve(plan({}));
	await Promise.all([a, b, c]);
});

test("a failed read clears the flight so the next read retries", async () => {
	const first = requestTodoList("ws-fail", "s-fail");
	readsFor("s-fail")[0]?.reject(new Error("host down"));
	await expect(first).rejects.toThrow("host down");

	const retry = requestTodoList("ws-fail", "s-fail");
	expect(readsFor("s-fail")).toHaveLength(2);
	readsFor("s-fail")[1]?.resolve(plan({}));
	await retry;
});

test("two mounted plan surfaces share one todo.list and the rail's opened marker is sent once", async () => {
	const seen: string[] = [];
	function Reader({ opened }: { opened?: "rail" | "page" }) {
		const { data } = useChatTodos("ws-hook", "s-hook", opened);
		useEffect(() => {
			if (data?.todos[0]) seen.push(data.todos[0].title);
		}, [data]);
		return null;
	}
	useAppStore.setState({ status: "connected", connectionGeneration: 1 });
	const root = createRoot(headlessContainer());
	try {
		await act(async () => {
			root.render(
				createElement(
					Fragment,
					null,
					createElement(Reader, { key: "rail", opened: "rail" }),
					createElement(Reader, { key: "page" }),
				),
			);
		});
		const reads = readsFor("s-hook");
		expect(reads).toHaveLength(1);
		expect(reads[0]?.params.opened).toBe("rail");
		await act(async () => {
			reads[0]?.resolve(plan({ todos: [{ ...item("done"), title: "shared" }] }));
		});
		expect(seen).toEqual(["shared", "shared"]);
	} finally {
		await act(async () => root.unmount());
		useAppStore.setState({ status: "connecting", connectionGeneration: 0 });
	}
});
