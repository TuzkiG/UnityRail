import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@thinkrail/contracts";
import { loadProjects, loadWorkspaces, saveProjects, saveWorkspaces } from "./persistence";

let root: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "trpi-json-cache-"));
	process.env.THINKRAIL_DATA_DIR = root;
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

function project(id: string) {
	return { id, name: id, path: join(root, id), slug: id, lastOpened: 1 };
}

function workspace(id: string): Workspace {
	return {
		id,
		projectId: "p1",
		kind: "default",
		name: id,
		branch: "main",
		worktreePath: join(root, id),
		baseBranch: "main",
	};
}

test("a project rewritten outside the host is visible to the next load", () => {
	const file = join(root, "projects.json");
	writeFileSync(file, JSON.stringify([project("first")]));
	expect(loadProjects().map((entry) => entry.id)).toEqual(["first"]);
	writeFileSync(file, JSON.stringify([project("second")]));
	expect(loadProjects().map((entry) => entry.id)).toEqual(["second"]);
});

test("a workspace save is visible to the very next load", () => {
	writeFileSync(join(root, "workspaces.json"), JSON.stringify([]));
	expect(loadWorkspaces()).toEqual([]);
	saveWorkspaces([workspace("one")]);
	expect(loadWorkspaces().map((entry) => entry.id)).toEqual(["one"]);
	saveWorkspaces([workspace("two")]);
	expect(loadWorkspaces().map((entry) => entry.id)).toEqual(["two"]);
});

test("a project save is visible to the very next load", () => {
	writeFileSync(join(root, "projects.json"), JSON.stringify([project("first")]));
	expect(loadProjects().map((entry) => entry.id)).toEqual(["first"]);
	saveProjects([project("saved")]);
	expect(loadProjects().map((entry) => entry.id)).toEqual(["saved"]);
});

test("a removed file falls back instead of serving the cached value", () => {
	const file = join(root, "projects.json");
	writeFileSync(file, JSON.stringify([project("first")]));
	expect(loadProjects()).toHaveLength(1);
	rmSync(file);
	expect(loadProjects()).toEqual([]);
});

test("callers may mutate a loaded list without poisoning the cache", () => {
	writeFileSync(join(root, "projects.json"), JSON.stringify([project("first")]));
	const loaded = loadProjects();
	const first = loaded[0];
	if (!first) throw new Error("fixture project missing");
	first.name = "changed";
	loaded.push(project("extra"));
	const again = loadProjects();
	expect(again).toHaveLength(1);
	expect(again[0]?.name).toBe("first");
});
