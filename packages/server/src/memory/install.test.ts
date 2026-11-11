import { describe, expect, test } from "bun:test";
import { openMemoryInstallTerminal } from "./install";

describe("openMemoryInstallTerminal", () => {
	test("spawns the platform terminal with the install command and reports success", () => {
		const calls: unknown[] = [];
		const spawn = ((argv: readonly string[], options: unknown) => {
			calls.push({ argv, options });
			return { unref: () => {} };
		}) as unknown as typeof Bun.spawn;
		expect(openMemoryInstallTerminal({ spawn })).toBe(true);
		expect(calls).toHaveLength(1);
		const { argv, options } = calls[0] as {
			argv: readonly string[];
			options: { windowsHide: boolean; detached: boolean };
		};
		expect(argv.at(-1)).toBe("pi install npm:@cloudfrog/memory");
		expect(options.windowsHide).toBe(false);
		expect(options.detached).toBe(true);
	});

	test("reports failure when the terminal cannot be opened", () => {
		const spawn = (() => {
			throw new Error("no terminal");
		}) as unknown as typeof Bun.spawn;
		expect(openMemoryInstallTerminal({ spawn })).toBe(false);
	});
});
