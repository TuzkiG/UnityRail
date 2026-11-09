import { describe, expect, test } from "bun:test";
import { OH_MY_PI_FIELDS, OH_MY_PI_STRINGS, OH_MY_PI_TOGGLES } from "./keys";

describe("oh-my-pi setting keys", () => {
	test("every string setting has exactly one home", () => {
		const owned = new Set<string>(Object.values(OH_MY_PI_FIELDS).flatMap((fields) => [...fields]));
		expect(owned.size).toBe(Object.keys(OH_MY_PI_STRINGS).length);
		expect([...owned].every((key) => key in OH_MY_PI_STRINGS)).toBe(true);
	});

	test("every toggle owns a group", () => {
		expect(Object.keys(OH_MY_PI_FIELDS).sort()).toEqual(Object.keys(OH_MY_PI_TOGGLES).sort());
	});
});
