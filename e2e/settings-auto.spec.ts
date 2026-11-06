import { expect, type Page, test } from "@playwright/test";
import type { AppConfig } from "@thinkrail/contracts";
import { E2eWire } from "./fixtures/wire";

type AutoSettings = Pick<
	AppConfig,
	"autoPlanModel" | "autoExecuteModel" | "autoEffort" | "autoReasoning"
>;

/** `settings.update` with an empty partial returns the persisted config. */
async function readAuto(page: Page): Promise<AutoSettings> {
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		const config = await wire.request("settings.update", { config: {} });
		return {
			...(config.autoPlanModel ? { autoPlanModel: config.autoPlanModel } : {}),
			...(config.autoExecuteModel ? { autoExecuteModel: config.autoExecuteModel } : {}),
			...(config.autoEffort ? { autoEffort: config.autoEffort } : {}),
			...(config.autoReasoning ? { autoReasoning: config.autoReasoning } : {}),
		};
	} finally {
		wire.close();
	}
}

test("Auto settings persist the reasoning level and both model rows expose Automatic", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("settings-nav-models").click();

	const group = page.getByTestId("models-auto-group");
	await expect(group.getByRole("heading", { name: "Auto" })).toBeVisible();
	const planRow = group.getByTestId("auto-plan-model-row");
	const executeRow = group.getByTestId("auto-execute-model-row");
	await expect(planRow).toContainText("Auto plan model");
	await expect(executeRow).toContainText("Auto execution model");

	// Both model rows carry the explicit Automatic default that null-clears the pin.
	for (const row of [planRow, executeRow]) {
		await row.getByTestId("model-selector").click();
		await expect(page.getByTestId("model-option-default")).toBeVisible();
		await page.keyboard.press("Escape");
	}

	// The level row offers the router's own levels; the choice is host state, not local UI state.
	const effortRow = group.getByTestId("auto-effort-row");
	const selector = effortRow.getByTestId("thinking-selector");
	await expect(selector).toBeEnabled();
	await selector.click();
	await page.locator('[data-testid="thinking-option"][data-level="high"]').click();
	await expect(selector).toContainText(/high/i);
	await expect.poll(async () => (await readAuto(page)).autoEffort).toBe("high");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-models").click();
	await expect(page.getByTestId("auto-effort-row").getByTestId("thinking-selector")).toContainText(
		/high/i,
	);

	// The plan row's Automatic restores the whole group, effort included.
	await page.getByTestId("auto-plan-model-row").getByTestId("model-selector").click();
	await page.getByTestId("model-option-default").click();
	await expect.poll(async () => readAuto(page)).toEqual({});

	// Automatic reasoning supersedes the manual level and persists across a reload.
	await page.getByTestId("auto-reasoning-toggle").click();
	await expect.poll(async () => (await readAuto(page)).autoReasoning).toBe("automatic");
	await expect(page.getByTestId("auto-effort-row")).toHaveCount(0);
	await expect(page.getByTestId("auto-reasoning-hint")).toBeVisible();

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-models").click();
	await expect(page.getByTestId("auto-reasoning-toggle")).toHaveAttribute("aria-checked", "true");
	await expect(page.getByTestId("auto-effort-row")).toHaveCount(0);

	// Turning it off returns the group to the chat's own level.
	await page.getByTestId("auto-reasoning-toggle").click();
	await expect.poll(async () => (await readAuto(page)).autoReasoning).toBeUndefined();
	await expect(page.getByTestId("auto-effort-row")).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
});
