import { useSyncExternalStore } from "react";

const NOW_TICK_MS = 30_000;
const listeners = new Set<() => void>();
let now = Date.now();
let ticker: ReturnType<typeof setInterval> | null = null;

function tick(): void {
	if (typeof document !== "undefined" && document.hidden) return;
	now = Date.now();
	for (const notify of listeners) notify();
}

function startTicker(): void {
	ticker = setInterval(tick, NOW_TICK_MS);
	if (typeof document !== "undefined") {
		document.addEventListener("visibilitychange", tick);
	}
}

function stopTicker(): void {
	if (ticker !== null) clearInterval(ticker);
	ticker = null;
	if (typeof document !== "undefined") {
		document.removeEventListener("visibilitychange", tick);
	}
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	if (ticker === null) startTicker();
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) stopTicker();
	};
}

function readNow(): number {
	if (Date.now() - now >= NOW_TICK_MS) now = Date.now();
	return now;
}

export function useNow(): number {
	return useSyncExternalStore(subscribe, readNow, readNow);
}
