import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { UnityTestResult, UnityTestRunStatus, VerificationRun } from "@thinkrail/contracts";
import { dataDir } from "../persistence";

const MAX_RUNS = 20;
const MAX_RESULTS = 400;

function storePath(workspaceId: string): string {
	const dir = join(dataDir(), "verification-runs");
	mkdirSync(dir, { recursive: true });
	return join(dir, `${workspaceId}.json`);
}

function sanitizeResults(results: readonly UnityTestResult[]): {
	results: UnityTestResult[];
	truncated: boolean;
} {
	const failedFirst = [...results].sort((left, right) => {
		const rank = (status: UnityTestResult["status"]) => (status === "failed" ? 0 : 1);
		return rank(left.status) - rank(right.status);
	});
	return {
		results: failedFirst.slice(0, MAX_RESULTS).map((result) => ({
			name: result.name,
			fullName: result.fullName,
			status: result.status,
			durationMs: result.durationMs,
			...(result.message ? { message: result.message.slice(0, 4_000) } : {}),
			...(result.stackTrace ? { stackTrace: result.stackTrace.slice(0, 16_000) } : {}),
		})),
		truncated: results.length > MAX_RESULTS,
	};
}

export function listVerificationRuns(workspaceId: string): VerificationRun[] {
	const path = storePath(workspaceId);
	if (!existsSync(path)) return [];
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((entry): entry is VerificationRun => {
			if (typeof entry !== "object" || entry === null) return false;
			const candidate = entry as VerificationRun;
			return (
				typeof candidate.id === "string" &&
				typeof candidate.workspaceId === "string" &&
				typeof candidate.createdAt === "number" &&
				typeof candidate.run === "object" &&
				candidate.run !== null
			);
		});
	} catch {
		return [];
	}
}

function writeRuns(workspaceId: string, runs: VerificationRun[]): void {
	const path = storePath(workspaceId);
	const temporary = `${path}.tmp`;
	writeFileSync(temporary, JSON.stringify(runs));
	renameSync(temporary, path);
}

/** Keeps the newest runs, failed-first results, and nothing the panel cannot render. */
export function recordUnityTestRun(
	workspaceId: string,
	run: UnityTestRunStatus,
	filter?: string,
): VerificationRun {
	const { results, truncated } = sanitizeResults(run.results);
	const record: VerificationRun = {
		id: `vr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
		workspaceId,
		kind: "unity-tests",
		createdAt: Date.now(),
		...(filter ? { filter } : {}),
		run: { ...run, results },
		...(truncated ? { resultsTruncated: true } : {}),
	};
	const runs = [record, ...listVerificationRuns(workspaceId)].slice(0, MAX_RUNS);
	try {
		writeRuns(workspaceId, runs);
	} catch {
		// History is a convenience; losing a write must never fail the test run itself.
	}
	return record;
}

export function forgetWorkspaceVerification(workspaceId: string): void {
	rmSync(storePath(workspaceId), { force: true });
}
