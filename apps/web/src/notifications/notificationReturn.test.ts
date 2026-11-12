import { expect, test } from "bun:test";
import {
	NOTIFICATION_RETURN_GRACE_MS,
	NOTIFICATION_RETURN_LIMIT,
	type PendingReturn,
	pickReturnTarget,
	rememberReturnTarget,
} from "./notificationReturn";

const chat = (sessionId: string, workspaceId = "ws1"): PendingReturn => ({
	target: { kind: "chat", workspaceId, sessionId },
	shownAt: 1_000,
});

test("remembers the newest notifications first and stays bounded", () => {
	let pending: PendingReturn[] = [];
	for (let index = 0; index < NOTIFICATION_RETURN_LIMIT + 2; index += 1) {
		pending = rememberReturnTarget(
			pending,
			{ kind: "chat", workspaceId: "ws", sessionId: `s${index}` },
			index,
		);
	}
	expect(pending).toHaveLength(NOTIFICATION_RETURN_LIMIT);
	expect(pending[0]?.target).toEqual({ kind: "chat", workspaceId: "ws", sessionId: "s5" });
});

test("returns the newest still-lit chat inside the grace window", () => {
	const pending = [chat("newest"), chat("older")];
	expect(pickReturnTarget(pending, 1_000 + NOTIFICATION_RETURN_GRACE_MS, () => true)).toEqual({
		workspaceId: "ws1",
		sessionId: "newest",
	});
	expect(pickReturnTarget(pending, 1_000 + 5_000, (id) => id === "older")).toEqual({
		workspaceId: "ws1",
		sessionId: "older",
	});
});

test("ignores stale notifications, answered sessions, and aggregate targets", () => {
	const stale = chat("stale");
	expect(
		pickReturnTarget([stale], stale.shownAt + NOTIFICATION_RETURN_GRACE_MS + 1, () => true),
	).toBeNull();
	expect(pickReturnTarget([chat("answered")], 2_000, () => false)).toBeNull();
	expect(
		pickReturnTarget([{ target: { kind: "search" }, shownAt: 1_000 }], 2_000, () => true),
	).toBeNull();
	expect(pickReturnTarget([], 2_000, () => true)).toBeNull();
});
