import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOGIN_ENV_MARKER } from "@thinkrail/shared/shellEnv";

function findOnPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
	return (env.PATH ?? "")
		.split(delimiter)
		.filter(Boolean)
		.map((directory) => join(directory, name))
		.find(existsSync);
}

let gitRoot: string | null = null;

/** Git for Windows' install root: the interpreter both `git` and the POSIX terminal specs need. */
function windowsGitRoot(env: NodeJS.ProcessEnv = process.env): string {
	if (gitRoot) return gitRoot;
	const executable = findOnPath("git.exe", env);
	if (!executable) throw new Error("git executable not found to build the e2e host PATH");
	for (let directory = dirname(executable); ; directory = dirname(directory)) {
		const complete =
			existsSync(join(directory, "usr", "bin", "bash.exe")) &&
			existsSync(join(directory, "mingw64", "bin", "git.exe"));
		if (complete) {
			gitRoot = directory;
			return directory;
		}
		if (dirname(directory) === directory)
			throw new Error(`no Git for Windows install root above ${executable}`);
	}
}

export function windowsGitBash(): string {
	// Git for Windows' `bin/bash.exe` is a launcher whose child is the real shell, which the host's
	// idle-tab probe reads as a running process; the PTY shell is the distribution's own `usr/bin` one.
	return windowsPath(join(windowsGitRoot(), "usr", "bin", "bash.exe"));
}

/** A Windows PATH entry: native consumers accept `/`, and the terminal's login shell converts them. */
function windowsPath(path: string): string {
	return path.replaceAll("\\", "/");
}

export function resolveBunExecutable(env: NodeJS.ProcessEnv = process.env): string {
	const name = process.platform === "win32" ? "bun.exe" : "bun";
	const executable = findOnPath(name, env);
	if (executable) return executable;
	// An npm-installed Bun puts only a `bun.cmd`/`bun.ps1` shim on PATH; the real binary sits inside
	// that prefix's own `node_modules/bun/bin`. A bun-managed install keeps it under BUN_INSTALL.
	const directories = (env.PATH ?? "").split(delimiter).filter(Boolean);
	const candidates = [
		...directories.map((directory) => join(directory, "node_modules", "bun", "bin", name)),
		env.BUN_INSTALL ? join(env.BUN_INSTALL, "bin", name) : "",
		join(homedir(), ".bun", "bin", name),
		process.execPath,
	].filter(Boolean);
	const candidate = candidates.find(
		(candidate) => existsSync(candidate) && /(?:^|[\\/])bun(?:\.exe)?$/i.test(candidate),
	);
	if (!candidate) throw new Error("bun executable not found for the e2e host");
	return candidate;
}

function executableSuffixes(env: NodeJS.ProcessEnv): string[] {
	if (process.platform !== "win32") return [""];
	return ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)];
}

export function executableOnPath(
	path: string,
	name: string,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const suffixes = executableSuffixes(env);
	return path
		.split(delimiter)
		.filter(Boolean)
		.flatMap((directory) => suffixes.map((suffix) => join(directory, name + suffix)))
		.find(existsSync);
}

const FAKED_TOOLS = ["pi", "central", "code"];

export function hermeticE2ePath(fakeBinDir: string, env: NodeJS.ProcessEnv = process.env): string {
	if (process.platform !== "win32")
		return [fakeBinDir, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(delimiter);
	const git = findOnPath("git.exe", env);
	if (!git) throw new Error("git executable not found for the e2e host");
	const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
	const ambient = [dirname(git), join(systemRoot, "System32"), systemRoot].join(delimiter);
	for (const tool of FAKED_TOOLS) {
		const real = executableOnPath(ambient, tool, env);
		if (real) throw new Error(`e2e host PATH would expose a real ${tool}: ${real}`);
	}
	return [fakeBinDir, ambient].join(delimiter);
}

export function hermeticE2eShell(fakeBinDir: string): string {
	// A Windows host cannot execute the POSIX probe wrapper as a PTY shell; Git for Windows' bash is the
	// interpreter the terminal specs' POSIX commands need, and it re-derives the MSYS PATH from the
	// hermetic environment instead of importing a developer login environment.
	if (process.platform === "win32") return windowsGitBash();
	return join(fakeBinDir, "login-shell");
}

export function writeHermeticE2eShell(fakeBinDir: string, realShell: string): void {
	if (process.platform === "win32") return;
	const script = [
		"#!/bin/sh",
		'case "$*" in',
		`\t*${shellQuote(LOGIN_ENV_MARKER)}*) printf '%sPATH=%s\\0' ${shellQuote(LOGIN_ENV_MARKER)} ${shellQuote(hermeticE2ePath(fakeBinDir))}; exit 0 ;;`,
		"esac",
		`exec ${shellQuote(realShell)} "$@"`,
		"",
	].join("\n");
	const target = hermeticE2eShell(fakeBinDir);
	writeFileSync(target, script);
	chmodSync(target, 0o755);
}

/**
 * Windows resolves a bare command through PATHEXT and runs a `.cmd` launcher, so every POSIX stub in
 * the fake bin dir gets one next to it. The `.cmd` forwards the caller's own command line, so an argv
 * assertion still sees exactly what the host spawned.
 */
export function writeWindowsCommandShim(fakeBinDir: string, command: string): void {
	if (process.platform !== "win32") return;
	const script = join(fakeBinDir, command);
	writeFileSync(
		join(fakeBinDir, `${command}.cmd`),
		`@echo off\r\n"${windowsGitBash()}" "${windowsPath(script)}" %*\r\n`,
	);
}

export function writeFakeGh(fakeBinDir: string, scenarioPath: string, logPath: string): void {
	const source = fileURLToPath(new URL("./fakeGh.ts", import.meta.url));
	const script = [
		"#!/bin/sh",
		`exec ${[resolveBunExecutable(), source, scenarioPath, logPath].map(shellQuote).join(" ")} "$@"`,
		"",
	].join("\n");
	const target = join(fakeBinDir, "gh");
	writeFileSync(target, script);
	chmodSync(target, 0o755);
	writeWindowsCommandShim(fakeBinDir, "gh");
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}
