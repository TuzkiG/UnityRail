import { RunningIcon } from "../components/RunningIcon";
import { selectSessionIsWorking, useAppStore } from "../store";

/**
 * A chat tab wears the brand's working badge while its session is working — the same
 * vocabulary the project tree and the location bar use for "an agent is working here".
 */
export function ChatTabRunningMark({
	workspaceId,
	sessionId,
}: {
	workspaceId: string;
	sessionId: string;
}) {
	const working = useAppStore((state) => selectSessionIsWorking(state, workspaceId, sessionId));
	if (!working) return null;
	return <RunningIcon className="size-14 shrink-0 text-primary" />;
}
