import type { NativeWindowState } from "@thinkrail/contracts";
import { prependPreloadGlobal } from "./preloadGlobals";

export type WindowChromeGeometry = Readonly<{
	insetLeft: number;
	insetRight: number;
}>;

export type WindowChromePolicy = Readonly<{
	titleBarStyle: "default" | "hiddenInset";
	trafficLightOffset: { x: number; y: number } | null;
	geometry: WindowChromeGeometry;
	dragRegion: boolean;
	titleBarDoubleClick: boolean;
	windowControls: boolean;
	restoreFrameControls: boolean;
}>;

export type WindowChromePreloadSeed = Readonly<
	WindowChromeGeometry & {
		dragRegion: boolean;
		windowControls: boolean;
	}
>;

export const INITIAL_WINDOW_CHROME_GLOBAL = "__THINKRAIL_INITIAL_WINDOW_CHROME__";
export const NATIVE_WINDOW_CONTROLS_GLOBAL = "__THINKRAIL_NATIVE_WINDOW_CONTROLS__";
const WINDOW_CHROME_INSET_LEFT_PROPERTY = "--window-chrome-inset-left";
const WINDOW_CHROME_INSET_RIGHT_PROPERTY = "--window-chrome-inset-right";
const WINDOW_CHROME_DRAG_REGION_ATTRIBUTE = "data-window-chrome-drag-region";
export const MAX_WINDOW_CHROME_INSET = 512;

const NO_INSETS: WindowChromeGeometry = { insetLeft: 0, insetRight: 0 };

export function desktopWindowChrome(platform: NodeJS.Platform): WindowChromePolicy {
	if (platform === "darwin") {
		return {
			titleBarStyle: "hiddenInset",
			trafficLightOffset: { x: 0, y: 4 },
			geometry: { insetLeft: 64, insetRight: 0 },
			dragRegion: true,
			titleBarDoubleClick: true,
			windowControls: false,
			restoreFrameControls: false,
		};
	}
	if (platform === "win32") {
		return {
			titleBarStyle: "hiddenInset",
			trafficLightOffset: null,
			geometry: { insetLeft: 0, insetRight: 138 },
			dragRegion: true,
			titleBarDoubleClick: false,
			windowControls: true,
			restoreFrameControls: true,
		};
	}
	return {
		titleBarStyle: "default",
		trafficLightOffset: null,
		geometry: NO_INSETS,
		dragRegion: false,
		titleBarDoubleClick: false,
		windowControls: false,
		restoreFrameControls: false,
	};
}

export function windowChromeGeometry(
	policy: WindowChromePolicy,
	fullScreen: boolean,
): WindowChromeGeometry {
	return fullScreen ? NO_INSETS : policy.geometry;
}

export function windowChromePreloadSeed(policy: WindowChromePolicy): WindowChromePreloadSeed {
	return {
		...policy.geometry,
		dragRegion: policy.dragRegion,
		windowControls: policy.windowControls,
	};
}

function isWindowChromeInset(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= 0 &&
		value <= MAX_WINDOW_CHROME_INSET
	);
}

export function readWindowChromeGeometry(payload: unknown): WindowChromeGeometry | null {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
	const insetLeft = Reflect.get(payload, "insetLeft");
	const insetRight = Reflect.get(payload, "insetRight");
	return isWindowChromeInset(insetLeft) && isWindowChromeInset(insetRight)
		? { insetLeft, insetRight }
		: null;
}

export function injectInitialWindowChrome(
	preloadSource: string,
	seed: WindowChromePreloadSeed,
): string {
	return prependPreloadGlobal(preloadSource, INITIAL_WINDOW_CHROME_GLOBAL, seed);
}

export function readWindowChromeFlag(
	payload: unknown,
	name: "dragRegion" | "windowControls",
): boolean | null {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
	const value = Reflect.get(payload, name);
	return typeof value === "boolean" ? value : null;
}

export interface WindowChromeRoot {
	style: Pick<CSSStyleDeclaration, "setProperty">;
	setAttribute(name: string, value: string): void;
}

export function createWindowChromeStyleWriter(getRoot: () => WindowChromeRoot | null): {
	update(payload: unknown): void;
	flush(): void;
} {
	let geometry: WindowChromeGeometry | undefined;
	let dragRegion: boolean | undefined;
	const flush = () => {
		const root = getRoot();
		if (!root || !geometry) return;
		root.style.setProperty(WINDOW_CHROME_INSET_LEFT_PROPERTY, `${geometry.insetLeft}px`);
		root.style.setProperty(WINDOW_CHROME_INSET_RIGHT_PROPERTY, `${geometry.insetRight}px`);
		if (dragRegion !== undefined) {
			root.setAttribute(WINDOW_CHROME_DRAG_REGION_ATTRIBUTE, dragRegion ? "drag" : "no-drag");
		}
	};
	return {
		update(payload) {
			const nextGeometry = readWindowChromeGeometry(payload);
			if (!nextGeometry) return;
			geometry = nextGeometry;
			const nextDragRegion = readWindowChromeFlag(payload, "dragRegion");
			if (nextDragRegion !== null) dragRegion = nextDragRegion;
			flush();
		},
		flush,
	};
}

export interface WindowChromeSnapshot {
	geometry: WindowChromeGeometry;
	state?: NativeWindowState;
}

const WINDOW_CHROME_RESIZE_DELAY_MS = 75;

function sameWindowChromeGeometry(a: WindowChromeGeometry, b: WindowChromeGeometry): boolean {
	return a.insetLeft === b.insetLeft && a.insetRight === b.insetRight;
}

export function sameWindowChromeSnapshot(
	a: WindowChromeSnapshot,
	b: WindowChromeSnapshot,
): boolean {
	if (!sameWindowChromeGeometry(a.geometry, b.geometry)) return false;
	if (a.state === undefined || b.state === undefined) return a.state === b.state;
	return sameNativeWindowState(a.state, b.state);
}

export function installWindowChromeUpdates(
	window: {
		on(name: "resize", listener: () => void): void;
		webview: { on(name: "dom-ready", listener: () => void): void };
	},
	read: () => WindowChromeSnapshot,
	publish: (snapshot: WindowChromeSnapshot) => void,
	delayMs = WINDOW_CHROME_RESIZE_DELAY_MS,
): void {
	let last: WindowChromeSnapshot | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const publishLatest = (): void => {
		timer = undefined;
		const next = read();
		if (last !== undefined && sameWindowChromeSnapshot(last, next)) return;
		last = next;
		publish(next);
	};
	window.on("resize", () => {
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(publishLatest, delayMs);
	});
	window.webview.on("dom-ready", () => {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		const next = read();
		last = next;
		publish(next);
	});
}

export function readNativeWindowState(window: {
	isMaximized(): boolean;
	isFullScreen(): boolean;
}): NativeWindowState {
	return { maximized: window.isMaximized(), fullScreen: window.isFullScreen() };
}

export function sameNativeWindowState(a: NativeWindowState, b: NativeWindowState): boolean {
	return a.maximized === b.maximized && a.fullScreen === b.fullScreen;
}
