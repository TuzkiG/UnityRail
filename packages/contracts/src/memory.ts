/** The Memory engine's install state as the host sees it, for the settings page's engine group. */
export interface MemoryEngineStatus {
	/** Whether a Memory engine binary resolves from the `memory` extension's `memoryBin` setting. */
	engine: "installed" | "missing";
	/** The `memoryBin` value the probe resolved against (the setting, or the default name). */
	binary: string;
	/** The local port or the configured `memoryUrl` the probe targeted. */
	server: "running" | "absent" | "foreign";
	/** The probe target: the local port for the default layout, `null` when `memoryUrl` is set. */
	port: number | null;
	/** The resolved probe target URL (memoryUrl or the local address). */
	url: string;
}
