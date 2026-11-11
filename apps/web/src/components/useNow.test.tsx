import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useNow } from "./useNow";

type ReactGlobals = { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined; window?: unknown };
const globals = globalThis as ReactGlobals;
const saved = { act: globals.IS_REACT_ACT_ENVIRONMENT, window: globals.window };

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

const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
const realNow = Date.now;
const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");

afterEach(() => {
	globalThis.setInterval = realSetInterval;
	globalThis.clearInterval = realClearInterval;
	Date.now = realNow;
	if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
	else Reflect.deleteProperty(globalThis, "document");
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

test("a hidden ticker stays quiet and becoming visible ticks once", async () => {
	let clock = realNow() + 1_000_000;
	Date.now = () => clock;

	let visible = false;
	const visibilityListeners = new Set<() => void>();
	const fakeDocument = {
		get hidden() {
			return !visible;
		},
		addEventListener: (type: string, listener: () => void) => {
			if (type === "visibilitychange") visibilityListeners.add(listener);
		},
		removeEventListener: (type: string, listener: () => void) => {
			if (type === "visibilitychange") visibilityListeners.delete(listener);
		},
	};
	Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });

	let intervalCallback: (() => void) | null = null;
	let cleared = false;
	globalThis.setInterval = ((callback: () => void) => {
		intervalCallback = callback;
		return 1 as unknown as ReturnType<typeof setInterval>;
	}) as unknown as typeof setInterval;
	globalThis.clearInterval = (() => {
		cleared = true;
	}) as unknown as typeof clearInterval;

	const values: number[] = [];
	function Probe() {
		values.push(useNow());
		return null;
	}

	const root = createRoot(headlessContainer());
	await act(async () => root.render(<Probe />));
	const initialRenders = values.length;
	expect(initialRenders).toBeGreaterThan(0);
	expect(intervalCallback).not.toBeNull();

	clock += 30_000;
	await act(async () => intervalCallback?.());
	expect(values).toHaveLength(initialRenders);

	visible = true;
	clock += 30_000;
	await act(async () => {
		for (const listener of visibilityListeners) listener();
	});
	expect(values).toHaveLength(initialRenders + 1);
	expect(values.at(-1)).toBe(clock);

	await act(async () => root.unmount());
	expect(cleared).toBe(true);
	expect(visibilityListeners.size).toBe(0);
});
