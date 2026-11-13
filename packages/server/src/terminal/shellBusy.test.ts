import { describe, expect, test } from "bun:test";
import {
	descendantsOfPid,
	hasChildProcesses,
	parseProcChildren,
	WINDOWS_PROCESS_TABLE,
} from "./shellBusy";

describe("parseProcChildren", () => {
	test("reads the pid list", () => {
		expect(parseProcChildren("1234 5678 91011\n")).toEqual([1234, 5678, 91011]);
	});

	test("no children is an empty file, not an absent one", () => {
		expect(parseProcChildren("")).toEqual([]);
		expect(parseProcChildren("\n")).toEqual([]);
	});

	test("ignores anything that is not a pid", () => {
		expect(parseProcChildren("12 junk -3 0 34")).toEqual([12, 34]);
	});
});

describe("hasChildProcesses", () => {
	test("a shell running something reports busy; a bare process does not", async () => {
		const withChild = Bun.spawn(
			[
				process.execPath,
				"-e",
				"Bun.spawn([process.execPath, '-e', 'setTimeout(() => {}, 30000)']); setTimeout(() => {}, 30000)",
			],
			{ stdout: "ignore", stderr: "ignore" },
		);
		const withoutChild = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30000)"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		try {
			await Bun.sleep(700);
			expect(hasChildProcesses(withChild.pid)).toBe(true);
			expect(hasChildProcesses(withoutChild.pid)).toBe(false);
		} finally {
			withChild.kill();
			withoutChild.kill();
		}
	}, 20_000);

	test("an implausible pid is not busy rather than throwing", () => {
		expect(hasChildProcesses(0)).toBe(false);
		expect(hasChildProcesses(-1)).toBe(false);
		expect(hasChildProcesses(Number.NaN)).toBe(false);
	});

	test("a pid that no longer exists is not busy", () => {
		const gone = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" });
		gone.kill();
		expect(hasChildProcesses(gone.pid)).toBe(false);
	});
});

describe("the Windows probe", () => {
	test("reads the process table as JSON, never by string interpolation", () => {
		expect(WINDOWS_PROCESS_TABLE).toContain("ConvertTo-Json");
		expect(WINDOWS_PROCESS_TABLE).not.toMatch(/ParentProcessId=\d/);
	});
});

describe("descendantsOfPid", () => {
	test("a direct child counts", () => {
		expect(descendantsOfPid(1, [{ ProcessId: 2, ParentProcessId: 1 }])).toBe(true);
	});

	test("a grandchild counts — Git Bash runs commands through its fork server", () => {
		expect(
			descendantsOfPid(1, [
				{ ProcessId: 2, ParentProcessId: 1 },
				{ ProcessId: 3, ParentProcessId: 2 },
			]),
		).toBe(true);
	});

	test("an unrelated process does not", () => {
		expect(
			descendantsOfPid(1, [
				{ ProcessId: 2, ParentProcessId: 9 },
				{ ProcessId: 3, ParentProcessId: 2 },
			]),
		).toBe(false);
	});

	test("a cycle in the table terminates", () => {
		expect(
			descendantsOfPid(1, [
				{ ProcessId: 2, ParentProcessId: 1 },
				{ ProcessId: 1, ParentProcessId: 2 },
			]),
		).toBe(true);
		expect(
			descendantsOfPid(5, [
				{ ProcessId: 6, ParentProcessId: 7 },
				{ ProcessId: 7, ParentProcessId: 6 },
			]),
		).toBe(false);
	});

	test("rows without both ids are ignored", () => {
		expect(descendantsOfPid(1, [{ ProcessId: 2 }, { ParentProcessId: 1 }])).toBe(false);
	});
});
