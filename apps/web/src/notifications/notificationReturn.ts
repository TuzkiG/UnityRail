import type { NotificationTarget } from "./formatNotification";

/**
 * How long after an OS notification a returning window still counts as "the user clicked the toast".
 * The desktop shell cannot report a notification click (see SPEC), so a window focus inside this
 * window is the only signal available; longer than this and the user is simply coming back.
 */
export const NOTIFICATION_RETURN_GRACE_MS = 120_000;

/** At most this many pending notifications are remembered (one per collection-window flush). */
export const NOTIFICATION_RETURN_LIMIT = 4;

export interface PendingReturn {
	target: NotificationTarget;
	shownAt: number;
}

/** Remembers one emitted notification, newest first and bounded. */
export function rememberReturnTarget(
	pending: readonly PendingReturn[],
	target: NotificationTarget,
	shownAt: number,
): PendingReturn[] {
	return [{ target, shownAt }, ...pending].slice(0, NOTIFICATION_RETURN_LIMIT);
}

/**
 * The chat a returning window should open: the newest notification still inside the grace window whose
 * session is still awaiting attention. Aggregate (`search`) targets are skipped — reopening a palette
 * on every return would be worse than landing on the workspace's current chat.
 */
export function pickReturnTarget(
	pending: readonly PendingReturn[],
	now: number,
	isStillLit: (sessionId: string) => boolean,
): { workspaceId: string; sessionId: string } | null {
	for (const entry of pending) {
		if (now - entry.shownAt > NOTIFICATION_RETURN_GRACE_MS) continue;
		const { target } = entry;
		if (target.kind !== "chat") continue;
		if (!isStillLit(target.sessionId)) continue;
		return { workspaceId: target.workspaceId, sessionId: target.sessionId };
	}
	return null;
}
