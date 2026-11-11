import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { MemoryProject, MemoryProjectsSnapshot } from "@thinkrail/contracts";

/** Basic Memory's data dir: `BASIC_MEMORY_CONFIG_DIR`, else `~/.basic-memory`. */
export function memoryConfigDir(): string {
	const override = process.env.BASIC_MEMORY_CONFIG_DIR?.trim();
	return override ? resolve(override) : join(homedir(), ".basic-memory");
}

export function memoryConfigPath(): string {
	return join(memoryConfigDir(), "config.json");
}

/** The folder Basic Memory gives the `main` project before any config exists. */
export function defaultMemoryProjectPath(): string {
	return join(homedir(), "basic-memory");
}

interface ConfigProjectEntry {
	path?: unknown;
	mode?: unknown;
}

interface MemoryConfigFile {
	projects?: unknown;
	default_project?: unknown;
}

function readConfig(): MemoryConfigFile | null {
	try {
		const parsed = JSON.parse(readFileSync(memoryConfigPath(), "utf8")) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as MemoryConfigFile) : null;
	} catch {
		return null;
	}
}

function projectEntries(config: MemoryConfigFile | null): Record<string, ConfigProjectEntry> {
	const projects = config?.projects;
	if (!projects || typeof projects !== "object" || Array.isArray(projects)) return {};
	const entries: Record<string, ConfigProjectEntry> = {};
	for (const [name, value] of Object.entries(projects as Record<string, unknown>)) {
		if (name.trim().length === 0) continue;
		// v0.24 stores `{ path, mode }`; older files stored a bare path string.
		if (typeof value === "string") entries[name] = { path: value, mode: "local" };
		else if (value && typeof value === "object") entries[name] = value as ConfigProjectEntry;
	}
	return entries;
}

function projectFromEntry(
	name: string,
	entry: ConfigProjectEntry,
	defaultProject: string | null,
): MemoryProject | null {
	const path = typeof entry.path === "string" ? entry.path.trim() : "";
	if (!path) return null;
	const abs = resolve(path);
	return {
		name,
		path: abs,
		mode: entry.mode === "cloud" ? "cloud" : "local",
		isDefault: name === defaultProject,
		exists: existsSync(abs),
	};
}

/** The Basic Memory projects a user's config declares, default project first. */
export function readMemoryProjects(): MemoryProjectsSnapshot {
	const configPath = memoryConfigPath();
	const exists = existsSync(configPath);
	const config = exists ? readConfig() : null;
	const declared = projectEntries(config);
	const defaultProject =
		typeof config?.default_project === "string" && config.default_project.trim()
			? config.default_project.trim()
			: null;
	const projects: MemoryProject[] = [];
	for (const [name, entry] of Object.entries(declared)) {
		const project = projectFromEntry(name, entry, defaultProject);
		if (project) projects.push(project);
	}
	if (projects.length === 0) {
		// Before `bm` has ever run there is no config; document the default project it will create.
		projects.push({
			name: defaultProject ?? "main",
			path: defaultMemoryProjectPath(),
			mode: "local",
			isDefault: true,
			exists: existsSync(defaultMemoryProjectPath()),
		});
	}
	// An unset default means "the first configured project" (the documented rule).
	const effectiveDefault = defaultProject ?? projects[0]?.name ?? null;
	for (const project of projects) project.isDefault = project.name === effectiveDefault;
	projects.sort(
		(a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name),
	);
	return {
		configPath,
		exists,
		defaultProject: effectiveDefault,
		projects,
	};
}

/** Resolves one project by name; throws a CodedError for an unknown name. */
export function memoryProject(name: string): MemoryProject | null {
	if (typeof name !== "string" || name.trim().length === 0) return null;
	const wanted = name.trim();
	return readMemoryProjects().projects.find((project) => project.name === wanted) ?? null;
}
