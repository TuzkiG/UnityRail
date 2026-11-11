/** The Basic Memory install as the host sees it, for the settings page's engine group. */
export interface MemoryEngineStatus {
	/** The `bm` CLI — the integration's transport and installer. */
	cli: {
		installed: boolean;
		/** The version `bm --version` printed, or null when it could not be read. */
		version: string | null;
		/** `version` is >= the 0.24 the Pi package requires. */
		supported: boolean;
	};
	/** `uv` installs the CLI (`uv tool install basic-memory`). */
	uv: boolean;
	/** The Pi package `bm install pi` copies into `~/.pi/agent/packages/basic-memory`. */
	piPackage: boolean;
	/** The Basic Memory config file the project list and folders come from. */
	configPath: string;
}

/** One Basic Memory project: a knowledge base mapped to one folder on disk. */
export interface MemoryProject {
	name: string;
	/** Absolute folder holding this project's Markdown notes. */
	path: string;
	mode: "local" | "cloud";
	isDefault: boolean;
	/** The folder currently exists. */
	exists: boolean;
}

export interface MemoryProjectsSnapshot {
	configPath: string;
	/** The config file exists; `projects` still carries the documented default project when it does not. */
	exists: boolean;
	defaultProject: string | null;
	projects: MemoryProject[];
}

/** One Markdown note under a Basic Memory project's folder. */
export interface MemoryNoteSummary {
	/** POSIX path relative to the project folder, e.g. `pi/sessions/2026-01-02-decision.md`. */
	path: string;
	/** The frontmatter `title`, or the filename stem when absent. */
	title: string;
	/** File size in bytes. */
	size: number;
	/** Last-modified epoch millis. */
	updatedAt: number;
}

export interface MemoryNotesSnapshot {
	/** The Basic Memory project the notes belong to. */
	project: string;
	/** The project's absolute folder. */
	root: string;
	exists: boolean;
	/** Newest first, bounded to the most recent files. */
	notes: MemoryNoteSummary[];
}

/** The per-project `.pi/basic-memory.json` the Basic Memory Pi package reads. */
export interface MemoryPiConfig {
	/** Absolute path of the config file (\`<project>/.pi/basic-memory.json\`). */
	path: string;
	exists: boolean;
	/** `cli` runs the bm CLI; `mcp` goes through pi-mcp-adapter. */
	transport: "cli" | "mcp";
	/** The Basic Memory project the package targets; null leaves the choice to the package. */
	project: string | null;
	captureFolder: string;
	autoRecall: boolean;
	autoCapture: boolean;
}

/** A partial config write; omitted keys keep their stored value. */
export interface MemoryPiConfigPatch {
	transport?: "cli" | "mcp";
	project?: string | null;
	captureFolder?: string;
	autoRecall?: boolean;
	autoCapture?: boolean;
}
