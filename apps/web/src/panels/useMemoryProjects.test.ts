import { expect, test } from "bun:test";
import type { MemoryProjectsSnapshot } from "@thinkrail/contracts";
import { preferredMemoryProject } from "./useMemoryProjects";

function snapshot(): MemoryProjectsSnapshot {
	return {
		configPath: "/home/u/.basic-memory/config.json",
		exists: true,
		defaultProject: "main",
		projects: [
			{ name: "main", path: "/home/u/basic-memory", mode: "local", isDefault: true, exists: true },
			{
				name: "thinkrail",
				path: "/home/u/code/thinkrail/docs",
				mode: "local",
				isDefault: false,
				exists: true,
			},
		],
	};
}

test("prefers the project whose name matches the app project", () => {
	expect(preferredMemoryProject(snapshot(), "ThinkRail")?.name).toBe("thinkrail");
	expect(preferredMemoryProject(snapshot(), "thinkrail-notes")?.name).toBe("thinkrail");
});

test("falls back to the default project, then the first one", () => {
	expect(preferredMemoryProject(snapshot(), "unrelated")?.name).toBe("main");
	expect(preferredMemoryProject(snapshot(), null)?.name).toBe("main");
	const noDefault = {
		...snapshot(),
		projects: snapshot().projects.map((project) => ({ ...project, isDefault: false })),
	};
	expect(preferredMemoryProject(noDefault)?.name).toBe("main");
});

test("answers null without a snapshot or projects", () => {
	expect(preferredMemoryProject(null)).toBeNull();
	expect(preferredMemoryProject({ ...snapshot(), projects: [] })).toBeNull();
});
