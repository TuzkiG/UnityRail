/** Installing the CLI, then the Pi package, exactly as the Basic Memory docs describe. */
export const MEMORY_CLI_INSTALL_COMMAND = "uv tool install basic-memory --prerelease=allow";
export const MEMORY_PI_INSTALL_COMMAND = "bm install pi --yes";

export interface MemoryTerminalOptions {
	/** Test seam: the terminal spawn; defaults to Bun.spawn. */
	spawn?: typeof Bun.spawn;
}

/**
 * The command the visible terminal runs: install the CLI first when `bm` is missing, then register
 * the Pi package. Both steps are idempotent, so re-running the button is safe.
 */
export function memoryInstallCommand(cliInstalled: boolean): string {
	return cliInstalled
		? MEMORY_PI_INSTALL_COMMAND
		: `${MEMORY_CLI_INSTALL_COMMAND} && ${MEMORY_PI_INSTALL_COMMAND}`;
}

/** The per-platform command line that opens a visible OS terminal running `command`. */
function terminalCommandLine(command: string): string[] {
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
 * Opens a visible terminal window running the install command. The window is the product, so the
 * child is detached with `windowsHide: false` (the one deliberate exception to the shared-spawn
 * convention, which always hides windows).
 */
export function openMemoryInstallTerminal(
	cliInstalled: boolean,
	options: MemoryTerminalOptions = {},
): boolean {
	const spawn = options.spawn ?? Bun.spawn;
	try {
		spawn(terminalCommandLine(memoryInstallCommand(cliInstalled)), {
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
