import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMemoryProjects } from "./config";

const savedConfigDir = process.env.BASIC_MEMORY_CONFIG_DIR;
let configDir: string;
let notesDir: string;

beforeEach(() => {
	configDir = mkdtempSync(join(tmpdir(), "trpi-bm-config-"));
	notesDir = mkdtempSync(join(tmpdir(), "trpi-bm-notes-"));
	process.env.BASIC_MEMORY_CONFIG_DIR = configDir;
});

afterEach(() => {
	rmSync(configDir, { recursive: true, force: true });
	rmSync(notesDir, { recursive: true, force: true });
	if (savedConfigDir === undefined) delete process.env.BASIC_MEMORY_CONFIG_DIR;
	else process.env.BASIC_MEMORY_CONFIG_DIR = savedConfigDir;
});

function writeConfig(value: unknown): void {
	writeFileSync(join(configDir, "config.json"), JSON.stringify(value), "utf8");
}

describe("readMemoryProjects", () => {
	test("synthesizes the documented default project before any config exists", () => {
		const snapshot = readMemoryProjects();
		expect(snapshot.exists).toBe(false);
		expect(snapshot.configPath).toBe(join(configDir, "config.json"));
		expect(snapshot.projects).toHaveLength(1);
		expect(snapshot.projects[0]?.name).toBe("main");
		expect(snapshot.projects[0]?.isDefault).toBe(true);
		expect(snapshot.projects[0]?.path.endsWith("basic-memory")).toBe(true);
	});

	test("reads v0.24 project entries and the default project", () => {
		mkdirSync(notesDir, { recursive: true });
		writeConfig({
			default_project: "work",
			projects: {
				main: { path: join(notesDir, "missing"), mode: "local" },
				work: { path: notesDir, mode: "cloud" },
			},
		});
		const snapshot = readMemoryProjects();
		expect(snapshot.exists).toBe(true);
		expect(snapshot.defaultProject).toBe("work");
		expect(snapshot.projects.map((project) => project.name)).toEqual(["work", "main"]);
		expect(snapshot.projects[0]).toEqual({
			name: "work",
			path: notesDir,
			mode: "cloud",
			isDefault: true,
			exists: true,
		});
		expect(snapshot.projects[1]?.exists).toBe(false);
	});

	test("accepts the legacy name-to-path map", () => {
		writeConfig({ projects: { main: notesDir } });
		const snapshot = readMemoryProjects();
		expect(snapshot.projects[0]).toEqual({
			name: "main",
			path: notesDir,
			mode: "local",
			isDefault: true,
			exists: true,
		});
	});

	test("ignores unreadable config and falls back to the default project", () => {
		writeFileSync(join(configDir, "config.json"), "{ not json", "utf8");
		expect(readMemoryProjects().projects[0]?.name).toBe("main");
	});
});
