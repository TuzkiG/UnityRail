import type { UnityTestRunStatus } from "./unity";

export interface VerificationRun {
	id: string;
	workspaceId: string;
	kind: "unity-tests";
	createdAt: number;
	filter?: string;
	run: UnityTestRunStatus;
	/** The run held more results than a history entry keeps. */
	resultsTruncated?: boolean;
}

export interface VerificationHistory {
	runs: VerificationRun[];
}
