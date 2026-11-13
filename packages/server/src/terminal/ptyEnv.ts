const INHERITED_NAMES: ReadonlySet<string> = new Set([
	"PWD",
	"OLDPWD",
	"SHLVL",
	"_",
	"BUN_PTY_LIB",
	"TERM_PROGRAM",
	"TERM_PROGRAM_VERSION",
	"TERM_SESSION_ID",
	"TERMINAL_EMULATOR",
	"LC_TERMINAL",
	"LC_TERMINAL_VERSION",
	"COLORFGBG",
	"WINDOWID",
	"WT_SESSION",
	"WT_PROFILE_ID",
	"TMUX",
	"TMUX_PANE",
	"STY",
	"FORCE_COLOR",
	"CLICOLOR_FORCE",
	"DEBUG_COLORS",
	"CLAUDECODE",
	"PI_CODING_AGENT",
	"AI_AGENT",
	"PI_SESSION_ID",
	"PI_SESSION_FILE",
	"PI_PROVIDER",
	"PI_MODEL",
	"PI_REASONING_LEVEL",
	"WINDOW",
	"TERMCAP",
	"COLUMNS",
	"LINES",
]);

const INHERITED_PREFIXES = [
	"THINKRAIL_",
	"ELECTROBUN_",
	"JITI_",
	"ITERM_",
	"VSCODE_",
	"KITTY_",
	"ALACRITTY_",
	"WEZTERM_",
	"GHOSTTY_",
	"KONSOLE_",
	"CLAUDE_CODE_",
];

const PAIRED_ASKPASS: ReadonlyArray<{ support: string; overrides: readonly string[] }> = [
	{ support: "VSCODE_GIT_ASKPASS_", overrides: ["GIT_ASKPASS"] },
	{ support: "VSCODE_SSH_ASKPASS_", overrides: ["SSH_ASKPASS", "SSH_ASKPASS_REQUIRE"] },
];

const ID_SEARCH_PATH = "/usr/bin:/bin:/run/current-system/sw/bin";
const ID_TIMEOUT_MS = 2_000;

function isInherited(name: string): boolean {
	return INHERITED_NAMES.has(name) || INHERITED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function pairedAskpassOverrides(names: readonly string[]): Set<string> {
	const dropped = new Set<string>();
	for (const { support, overrides } of PAIRED_ASKPASS) {
		if (names.some((name) => name.startsWith(support))) {
			for (const name of overrides) dropped.add(name);
		}
	}
	return dropped;
}

let cachedAccountName: string | null | undefined;

export function uidAccountName(): string | null {
	if (cachedAccountName === undefined) {
		try {
			const idPath = Bun.which("id", { PATH: ID_SEARCH_PATH });
			const id = idPath
				? Bun.spawnSync([idPath, "-un"], {
						stdin: "ignore",
						stderr: "ignore",
						timeout: ID_TIMEOUT_MS,
					})
				: null;
			cachedAccountName = (id?.success && id.stdout.toString().trim()) || null;
		} catch {
			cachedAccountName = null;
		}
	}
	return cachedAccountName;
}

export function terminalPtyEnv(
	platform: string,
	env: Record<string, string | undefined>,
	accountName: () => string | null = uidAccountName,
): Record<string, string> {
	const result: Record<string, string> = {};
	const askpassOverrides = pairedAskpassOverrides(Object.keys(env));
	const windows = platform === "win32";
	const emitted = new Set<string>();
	const put = (name: string, value: string): void => {
		const key = windows ? name.toUpperCase() : name;
		if (emitted.has(key)) return;
		emitted.add(key);
		result[name] = value;
	};
	// A Windows environment block is case-insensitive while `process.env` enumerates every spelling,
	// so a PTY could receive both `Path` and `PATH` and resolve the shell's search path arbitrarily.
	// Emit one spelling, and for PATH the one callers and tests actually set.
	if (windows) {
		const path = env.PATH ?? env.Path;
		if (typeof path === "string" && !isInherited("PATH")) put("PATH", path);
	}
	for (const [name, value] of Object.entries(env)) {
		if (typeof value === "string" && !isInherited(name) && !askpassOverrides.has(name)) {
			put(name, value);
		}
	}
	result.TERM = "xterm-256color";
	result.COLORTERM = "truecolor";
	result.TERM_PROGRAM = "UnityRail";
	const account = platform === "win32" ? null : accountName();
	if (account) {
		result.USER = account;
		result.LOGNAME = account;
	}
	return result;
}
