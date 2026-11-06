import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UnityTestRunStatus } from "@thinkrail/contracts";
import {
	forgetWorkspaceVerification,
	listVerificationRuns,
	recordUnityTestRun,
} from "./verification";

const WS = "ws-verification";
let dataDir: string;

function run(overrides: Partial<UnityTestRunStatus> = {}): UnityTestRunStatus {
	return {
		runId: `run-${Math.random().toString(36).slice(2, 8)}`,
		mode: "edit",
		state: "failed",
		startedAt: new Date().toISOString(),
		passed: 1,
		failed: 1,
		skipped: 0,
		results: [
			{ name: "Passes", fullName: "Suite.Passes", status: "passed", durationMs: 3 },
			{
				name: "Fails",
				fullName: "Suite.Fails",
				status: "failed",
				durationMs: 5,
				message: "expected 1 but was 2",
				stackTrace: "at Game.Player.Update () in Assets/Scripts/Player.cs:42",
			},
		],
		...overrides,
	};
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "verification-data-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
});

afterEach(() => {
	delete process.env.THINKRAIL_DATA_DIR;
	rmSync(dataDir, { recursive: true, force: true });
});

test("a recorded run is served newest-first and survives a fresh read", () => {
	const first = recordUnityTestRun(WS, run(), "Suite");
	const second = recordUnityTestRun(WS, run({ mode: "play", state: "passed", failed: 0 }));
	const runs = listVerificationRuns(WS);
	expect(runs.map((entry) => entry.id)).toEqual([second.id, first.id]);
	expect(runs[0]).toMatchObject({ kind: "unity-tests" });
	expect(runs[0]?.filter).toBeUndefined();
	expect(runs[1]?.filter).toBe("Suite");
});

test("history is capped and keeps failed results ahead of passing ones", () => {
	for (let index = 0; index < 25; index += 1) recordUnityTestRun(WS, run());
	const runs = listVerificationRuns(WS);
	expect(runs).toHaveLength(20);
	const many = Array.from({ length: 500 }, (_, index) => ({
		name: `T${index}`,
		fullName: `Suite.T${index}`,
		status: (index === 499 ? "failed" : "passed") as "failed" | "passed",
		durationMs: 1,
	}));
	const record = recordUnityTestRun(WS, run({ results: many, passed: 499, failed: 1 }));
	expect(record.resultsTruncated).toBe(true);
	expect(record.run.results).toHaveLength(400);
	expect(record.run.results[0]?.status).toBe("failed");
});

test("forgetting a workspace drops its history", () => {
	recordUnityTestRun(WS, run());
	forgetWorkspaceVerification(WS);
	expect(listVerificationRuns(WS)).toEqual([]);
});
