import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";
import { E2E_BASIC_MEMORY_DIR } from "./fixtures/paths";

const NOTES = join(E2E_BASIC_MEMORY_DIR, "notes-e2e");
const OTHER = join(E2E_BASIC_MEMORY_DIR, "other-e2e");
const CONFIG = join(E2E_BASIC_MEMORY_DIR, "config.json");

function seed(): void {
	mkdirSync(join(NOTES, "pi", "sessions"), { recursive: true });
	mkdirSync(OTHER, { recursive: true });
	writeFileSync(
		join(NOTES, "pi", "sessions", "runtime-decision.md"),
		"---\ntitle: Runtime decision\n---\n\n# Runtime decision\n\nWe picked **Bun**.\n",
		"utf8",
	);
	writeFileSync(
		CONFIG,
		JSON.stringify({
			default_project: "notes-e2e",
			projects: {
				"notes-e2e": { path: NOTES, mode: "local" },
				"other-e2e": { path: OTHER, mode: "local" },
			},
		}),
		"utf8",
	);
}

test.beforeEach(seed);

test.afterEach(() => {
	rmSync(E2E_BASIC_MEMORY_DIR, { recursive: true, force: true });
});

test("Settings → Memory lists the Basic Memory projects and edits a note in place", async ({
	page,
}) => {
	await openFixtureProject(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-memory").click();

	// The hermetic PATH has no `bm`/`uv` and no Pi package: the engine states say so, honestly.
	const engine = page.getByTestId("memory-engine");
	await expect(engine.getByTestId("memory-engine-cli")).toContainText("Not installed");
	await expect(engine.getByTestId("memory-engine-uv")).toContainText("Not found");
	await expect(engine.getByTestId("memory-engine-pi-package")).toContainText("Not installed");
	await expect(engine.getByTestId("memory-engine-config")).toHaveText(CONFIG);

	const projects = page.getByTestId("memory-projects");
	await expect(projects.getByTestId("memory-project-notes-e2e")).toBeVisible();
	await expect(projects.getByTestId("memory-project-other-e2e")).toBeVisible();

	// The first project is the default, so its one note is already listed.
	const note = page.getByTestId("memory-note-pi/sessions/runtime-decision.md");
	await expect(note).toBeVisible();
	await note.click();

	const dialog = page.getByTestId("memory-note-dialog");
	await expect(dialog.getByTestId("memory-note-preview")).toContainText("We picked");

	await dialog.getByTestId("memory-note-mode-edit").click();
	const editor = dialog.getByTestId("memory-note-editor");
	await expect(editor).toHaveValue(/We picked/);
	await editor.fill(
		"---\ntitle: Runtime decision\n---\n\n# Runtime decision\n\nWe picked **Bun** and kept it.\n",
	);
	await dialog.getByTestId("memory-note-save").click();
	await expect(dialog).toBeHidden();

	expect(readFileSync(join(NOTES, "pi", "sessions", "runtime-decision.md"), "utf8")).toContain(
		"and kept it",
	);

	// Switching projects shows the other project's (empty) tree, not the first one's notes.
	await projects.getByTestId("memory-project-other-e2e").click();
	await expect(page.getByTestId("memory-notes")).toContainText("No notes yet");
	expect(existsSync(CONFIG)).toBe(true);
});
