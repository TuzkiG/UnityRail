import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";
import { gitAs, gitQuiet } from "./fixtures/git";

test("Changes lists a nested repository's own files and diffs them in place", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);

	const embedded = join(workspace.worktreePath, "embed");
	mkdirSync(embedded);
	gitQuiet(embedded, "init", "-b", "main");
	gitQuiet(embedded, "config", "user.email", "e2e@thinkrail.test");
	gitQuiet(embedded, "config", "user.name", "e2e");
	gitQuiet(embedded, "config", "commit.gpgsign", "false");
	writeFileSync(join(embedded, "nested.txt"), "base\n");
	gitAs(embedded, "add", "-A");
	gitAs(embedded, "commit", "-m", "init");
	gitQuiet(embedded, "remote", "add", "origin", ".");
	gitQuiet(embedded, "update-ref", "refs/remotes/origin/main", "HEAD");
	gitQuiet(embedded, "config", "branch.main.remote", "origin");
	gitQuiet(embedded, "config", "branch.main.merge", "refs/heads/main");
	gitAs(embedded, "branch", "nested-only");
	writeFileSync(join(embedded, "nested.txt"), "ahead\n");
	gitAs(embedded, "commit", "-am", "ahead");
	writeFileSync(join(embedded, "nested.txt"), "edited by e2e\n");

	await revealWorkbenchTool(page, "changes");
	const group = page.getByTestId("change-repo-group").filter({ hasText: "embed" });
	await expect(group).toBeVisible({ timeout: 15_000 });
	const changed = page.getByTestId("change-item").filter({ hasText: "nested.txt" });
	await expect(changed).toHaveAttribute("data-status", "modified");
	await expect(changed).toHaveAttribute("data-repo", "embed");

	await expect(page.getByTestId("scope-nested-count")).toBeVisible({ timeout: 15_000 });
	await page.getByTestId("scope-branch-trigger").click();
	const nested = page.getByTestId("scope-nested-repo");
	await expect(nested).toHaveCount(1);
	await expect(nested).toHaveAttribute("data-repo", "embed");
	await expect(nested).toContainText("main");
	await expect(nested).toContainText("↑1");

	await changed.dblclick();
	await expect(page.getByTestId("diff-view")).toContainText("edited by e2e");

	await revealWorkbenchTool(page, "files");
	await expect(page.getByTestId("files-repo-trigger")).toBeVisible({ timeout: 15_000 });
	await page.getByTestId("files-repo-trigger").click();
	await page.locator('[data-testid="files-repo-option"][data-path="embed"]').click();
	await expect(page.getByTestId("file-node").filter({ hasText: "nested.txt" })).toBeVisible();
	await page.getByTestId("files-mode-changed").click();
	await expect(page.getByTestId("change-item").filter({ hasText: "nested.txt" })).toBeVisible();
	await expect(page.getByTestId("change-item")).toHaveCount(1);
	await page.getByTestId("changes-target-picker").click();
	await expect(
		page.locator('[data-testid="branch-option"][data-branch="nested-only"]'),
	).toBeVisible();
	await page.keyboard.press("Escape");

	// the review side groups a nested repository's files under its own header (no review comments, so
	// the section list is the assertion)
	await revealWorkbenchTool(page, "changes");
	await changed.click();
	const repoGroup = page.locator('[data-testid="changes-review-repo-group"][data-repo="embed"]');
	await expect(repoGroup).toBeVisible({ timeout: 15_000 });
	await expect(repoGroup).toContainText("embed");
	await expect(
		page.locator('[data-testid="changes-section"][data-path="embed/nested.txt"]'),
	).toBeVisible();
});
