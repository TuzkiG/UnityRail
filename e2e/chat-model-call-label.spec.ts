import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { seedWorkspaceSession } from "./fixtures/sessions";

test("every model call names the model and effort it ran on, per phase", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const promptAt = 1_700_000_000_000;
	seedWorkspaceSession(workspace.worktreePath, {
		name: "Auto shapes the turn",
		messages: [
			{ role: "user", text: "add the flag", timestamp: promptAt },
			{
				// The plan call: one thinking block, then a tool.
				role: "assistant",
				provider: "deepseek",
				model: "deepseek-v4-pro",
				thinkingLevel: "high",
				content: [
					{ type: "thinking", thinking: "Read the file before editing it." },
					{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "echo hi" } },
				],
				timestamp: promptAt + 1_000,
			},
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "bash",
				content: [{ type: "text", text: "hi" }],
				isError: false,
				timestamp: promptAt + 2_000,
			},
			{
				// The execution call Auto hands the turn to: a different model and effort.
				role: "assistant",
				provider: "deepseek",
				model: "deepseek-flash",
				thinkingLevel: "low",
				text: "Added the flag.",
				timestamp: promptAt + 3_000,
			},
		],
	});

	await page.reload();
	await openPersistedChat(page, "Auto shapes the turn");

	// The collapsed activity run names the call it came from…
	const activity = page.getByTestId("activity-group").getByTestId("activity-model");
	await expect(activity).toContainText("deepseek-v4-pro");
	await expect(activity).toContainText(/high/i);

	// …and the answer names its own, which Auto routed elsewhere.
	const answer = page.getByTestId("model-call");
	await expect(answer).toHaveCount(1);
	await expect(answer).toHaveAttribute("data-model", "deepseek/deepseek-flash");
	await expect(answer).toHaveAttribute("data-level", "low");
	await expect(answer).toContainText("deepseek-flash");
});
