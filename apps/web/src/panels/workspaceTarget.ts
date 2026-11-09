import type { NewWorkspaceTarget, Project } from "@thinkrail/contracts";

/** A project's preselected New-Workspace target; the wire field is optional, so absence is the app default. */
export function projectWorkspaceTarget(
	project: Pick<Project, "newWorkspaceTarget"> | undefined,
): NewWorkspaceTarget {
	return project?.newWorkspaceTarget ?? "worktree";
}
