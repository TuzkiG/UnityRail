/** The Memory engine's install state as the host sees it, for the settings page's engine group. */
export interface MemoryEngineStatus {
	/** Whether the `basic-memory` command resolves on PATH (`uv tool install`-installed). */
	engine: "installed" | "missing";
	/** Whether `uvx` resolves on PATH — the MCP preset's launcher, which fetches on demand. */
	uvx: "installed" | "missing";
}
