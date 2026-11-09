import { expect, test } from "bun:test";
import { projectWorkspaceTarget } from "./workspaceTarget";

test("a project without the setting preselects the isolated worktree — the app default", () => {
	expect(projectWorkspaceTarget(undefined)).toBe("worktree");
	expect(projectWorkspaceTarget({})).toBe("worktree");
});

test("the project setting only preselects its own target", () => {
	expect(projectWorkspaceTarget({ newWorkspaceTarget: "worktree" })).toBe("worktree");
	expect(projectWorkspaceTarget({ newWorkspaceTarget: "default" })).toBe("default");
});
