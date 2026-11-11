import { expect, test } from "bun:test";
import { createUpdatesCheckCache } from "./usePiPackages";

test("an update check is fresh only for the workspace and packages version it ran for", () => {
	const cache = createUpdatesCheckCache();
	const key = cache.key("ws-1", 3);
	expect(cache.isFresh(key)).toBe(false);
	expect(cache.cached(key)).toBeNull();

	cache.markAttempted(key);
	expect(cache.isFresh(key)).toBe(true);
	expect(cache.cached(key)).toBeNull();
	expect(cache.isFresh(cache.key("ws-2", 3))).toBe(false);

	const updates = new Set(["npm:a"]);
	cache.remember(key, updates);
	expect(cache.cached(key)).toBe(updates);
	expect(cache.cached(cache.key("ws-1", 4))).toBeNull();
	expect(cache.isFresh(cache.key("ws-1", 4))).toBe(false);
});
