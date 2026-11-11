export const MEMORY_INSTALL_COMMAND = "uv tool install basic-memory --prerelease=allow";

export interface MemoryTerminalOptions {
	/** Test seam: the terminal spawn; defaults to Bun.spawn. */
	spawn?: typeof Bun.spawn;
}

/** The per-platform command line that opens a visible OS terminal running the install command. */
function terminalCommandLine(): string[] {
	const command = MEMORY_INSTALL_COMMAND;
	if (process.platform === "win32") {
		return ["cmd.exe", "/c", "start", "", "cmd.exe", "/k", command];
	}
	if (process.platform === "darwin") {
		return [
			"osascript",
			"-e",
			`tell application "Terminal" to do script ${JSON.stringify(command)}`,
		];
	}
	return [
		"sh",
		"-c",
		`x-terminal-emulator -e ${JSON.stringify(`${command}; read -p "Press Enter to close"`)}`,
	];
}

/**
 * Opens a visible terminal window running the official install command. The window is the
 * product, so the child is detached with `windowsHide: false` (the one deliberate exception to
 * the shared-spawn convention, which always hides windows).
 */
export function openMemoryInstallTerminal(options: MemoryTerminalOptions = {}): boolean {
	const spawn = options.spawn ?? Bun.spawn;
	try {
		spawn(terminalCommandLine(), {
			stdout: "ignore",
			stderr: "ignore",
			detached: true,
			windowsHide: false,
		});
		return true;
	} catch {
		return false;
	}
}
