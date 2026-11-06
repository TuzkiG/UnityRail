import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";
import { gitAs } from "./fixtures/git";

const PREFAB = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_Name: Player
  m_Component:
  - component: {fileID: 400}
--- !u!4 &400
Transform:
  m_GameObject: {fileID: 100}
  m_LocalPosition: {x: 0, y: 1.5, z: 0}
  m_Father: {fileID: 0}
`;

test("a Unity prefab is reviewed as objects and a missing .meta is guarded", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const root = workspace.worktreePath;
	mkdirSync(join(root, "ProjectSettings"), { recursive: true });
	writeFileSync(
		join(root, "ProjectSettings", "ProjectVersion.txt"),
		"m_EditorVersion: 6000.0.0f1\n",
	);
	writeFileSync(join(root, ".gitignore"), "Library/\nTemp/\n");
	writeFileSync(
		join(root, ".gitattributes"),
		"*.unity merge=unityyamlmerge eol=lf\n*.prefab merge=unityyamlmerge eol=lf\n",
	);
	mkdirSync(join(root, "Assets"), { recursive: true });
	writeFileSync(join(root, "Assets", "Player.prefab"), PREFAB);
	gitAs(root, "add", "-A");
	gitAs(root, "commit", "-m", "unity scaffold");

	writeFileSync(
		join(root, "Assets", "Player.prefab"),
		PREFAB.replace("{x: 0, y: 1.5, z: 0}", "{x: 0, y: 4, z: 0}"),
	);

	await revealWorkbenchTool(page, "changes");
	const item = page.getByTestId("change-item").filter({ hasText: "Player.prefab" });
	await expect(item).toBeVisible({ timeout: 15_000 });
	await item.click();

	await expect(page.getByTestId("unity-asset-diff")).toBeVisible({ timeout: 15_000 });
	const added = page.getByTestId("unity-section-added");
	await expect(added).toContainText("GameObject");
	await expect(added).toContainText("Transform");
	await expect(page.getByTestId("unity-object").first()).toContainText("Player");

	await page.getByTestId("unity-mode-source").click({ force: true });
	await expect(page.getByTestId("unity-asset-diff")).toHaveCount(0);

	await expect(page.getByTestId("unity-guard")).toBeVisible({ timeout: 15_000 });
	await page.getByTestId("unity-guard-toggle").click();
	await expect(
		page.locator('[data-testid="unity-guard-finding"][data-code="MISSING_META"]'),
	).toBeVisible();
});

test("the Verify panel opens with its empty state", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await revealWorkbenchTool(page, "verify");
	await expect(page.getByTestId("verify-panel")).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId("verify-empty")).toContainText("No test run yet");
	await expect(page.getByTestId("verify-run-edit")).toBeVisible();
});
