import { expect, test } from "bun:test";
import { createScopedCache } from "./scopedCache";

test("a value is cached under its transport scope only", () => {
	const cache = createScopedCache<readonly string[]>();
	cache.set("http://a", ["a"]);
	expect(cache.peek("http://a")).toEqual(["a"]);
	expect(cache.peek("http://b")).toBeNull();
});

test("a scope can be forgotten", () => {
	const cache = createScopedCache<{ connected: boolean }>();
	cache.set("http://a", { connected: true });
	cache.forget("http://a");
	expect(cache.peek("http://a")).toBeNull();
});

test("the least recently read scope is evicted first", () => {
	const cache = createScopedCache<number>(2);
	cache.set("a", 1);
	cache.set("b", 2);
	expect(cache.peek("a")).toBe(1);
	cache.set("c", 3);
	expect(cache.peek("a")).toBe(1);
	expect(cache.peek("b")).toBeNull();
	expect(cache.peek("c")).toBe(3);
});

test("setting the same scope replaces its value", () => {
	const cache = createScopedCache<string>();
	cache.set("a", "first");
	cache.set("a", "second");
	expect(cache.peek("a")).toBe("second");
});
