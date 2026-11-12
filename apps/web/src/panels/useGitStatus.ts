import type { GitStatus } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { useRef, useState } from "react";
import {
	selectDiffBaseRef,
	selectDiffScope,
	selectDiffTabTargetRef,
	toast,
	useAppStore,
} from "../store";
import { errorText, wsErrorCode } from "../transport";
import { scopeKey } from "./changesModel";
import { peekGitStatus, readGitStatus } from "./gitStatusCache";
import { useWorkspaceRead } from "./useWorkspaceRead";

/** `null` reads nothing: a chat without a project has no git status to ask for. */
export function useGitStatus(workspaceId: string | null) {
	const setDiffScope = useAppStore((s) => s.setDiffScope);
	const effectiveWorkspaceId = workspaceId ?? "";
	const scope = useAppStore((s) => selectDiffScope(s, effectiveWorkspaceId));
	const baseRef = useAppStore((s) => selectDiffBaseRef(s, effectiveWorkspaceId));
	const targetRef = useAppStore((s) =>
		selectDiffTabTargetRef(s, { workspaceId: effectiveWorkspaceId, scope }),
	);
	const [status, setStatus] = useState<GitStatus | null>(() =>
		workspaceId ? peekGitStatus(workspaceId, scope, targetRef) : null,
	);
	const [error, setError] = useState<string | null>(null);
	const warnedRef = useRef(false);

	const { reload } = useWorkspaceRead(
		workspaceId,
		(id) => readGitStatus(id, scope, targetRef),
		{
			onResult: (result) => {
				setStatus(result);
				setError(null);
				warnedRef.current = false;
			},
			onFailure: (_id, failure) => {
				if (wsErrorCode(failure) === "UNKNOWN_COMMIT" && workspaceId) {
					setDiffScope(workspaceId, { kind: "branch" });
					toast.info(
						scope.kind === "turn" ? t("changes.panel.turnGone") : t("changes.panel.commitGone"),
					);
					return;
				}
				if (status && !warnedRef.current) {
					warnedRef.current = true;
					toast.error(t("changes.refreshFailed", { error: errorText(failure) }));
				}
				setError(errorText(failure));
			},
			onSwitch: () => {
				setStatus(workspaceId ? peekGitStatus(workspaceId, scope, targetRef) : null);
				setError(null);
				warnedRef.current = false;
			},
		},
		`${scopeKey(scope)}:${baseRef}`,
	);

	return { status, error, reload };
}
