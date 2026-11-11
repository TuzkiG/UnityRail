/** The Memory engine's install state as the host sees it, for the settings page's engine group. */
export interface MemoryEngineStatus {
	/** Whether the `basic-memory` command resolves on PATH (`uv tool install`-installed). */
	engine: "installed" | "missing";
	/** Whether `uvx` resolves on PATH — the MCP preset's launcher, which fetches on demand. */
	uvx: "installed" | "missing";
}

/** One Markdown note under the Basic Memory notes root, for the settings page's Notes group. */
export interface MemoryNoteSummary {
	/** POSIX path relative to the notes root, e.g. `home/decisions.md`. */
	path: string;
	/** The frontmatter `title`, or the filename stem when absent. */
	title: string;
	/** File size in bytes. */
	size: number;
	/** Last-modified epoch millis. */
	updatedAt: number;
}

export interface MemoryNotesSnapshot {
	/** The resolved notes root (absolute), whether it exists yet or not. */
	root: string;
	exists: boolean;
	/** Newest first; bounded to the most recent files. */
	notes: MemoryNoteSummary[];
}
