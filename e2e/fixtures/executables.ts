import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOGIN_ENV_MARKER } from "@thinkrail/shared/shellEnv";

const POSIX_SYSTEM_DIRS = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

export function resolveBunExecutable(env: NodeJS.ProcessEnv = process.env): string {
	const name = process.platform === "win32" ? "bun.exe" : "bun";
	const directories = (env.PATH ?? "").split(delimiter).filter(Boolean);
	const direct = directories.map((directory) => join(directory, name)).find(existsSync);
	if (direct) return direct;
	// An npm-installed Bun puts only a `bun.cmd`/`bun.ps1` shim on PATH; the real binary sits in
	// that prefix's own `node_modules/bun/bin`. A bun-managed install keeps it under BUN_INSTALL.
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

/**
 * Git for Windows' install root. The interpreter a Windows host needs for both `git` and the POSIX
 * terminal specs (coreutils, `sh`) is this distribution's, and it is only discoverable from the
 * runner's own PATH — never from the hermetic PATH this resolves for the host.
 */
let gitRoot: string | null = null;

function windowsGitRoot(): string {
	if (gitRoot) return gitRoot;
	const executable = (process.env.PATH ?? "")
		.split(delimiter)
		.filter(Boolean)
		.map((directory) => join(directory, "git.exe"))
		.find(existsSync);
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

function windowsSystemDirs(): string[] {
	const root = windowsGitRoot();
	const dirs = [join(root, "mingw64", "bin"), join(root, "usr", "bin")];
	const systemRoot = process.env.SystemRoot ?? process.env.windir;
	// The host's own child-process probe spawns `powershell.exe` by bare name on Windows.
	if (systemRoot) dirs.push(join(systemRoot, "System32", "WindowsPowerShell", "v1.0"));
	return dirs.map(windowsPath);
}

export function hermeticE2ePath(fakeBinDir: string): string {
	const systemDirs = process.platform === "win32" ? windowsSystemDirs() : POSIX_SYSTEM_DIRS;
	return [fakeBinDir, ...systemDirs].join(delimiter);
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
