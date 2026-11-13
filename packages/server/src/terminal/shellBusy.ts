import { readFileSync } from "node:fs";
import { spawnSyncCaptured } from "@thinkrail/shared/spawn";

export function parseProcChildren(contents: string): number[] {
	return contents
		.split(/\s+/)
		.map((entry) => Number.parseInt(entry, 10))
		.filter((pid) => Number.isInteger(pid) && pid > 0);
}

function childrenViaProc(pid: number): boolean | null {
	try {
		return parseProcChildren(readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8")).length > 0;
	} catch {
		return null;
	}
}

function childrenViaPgrep(pid: number): boolean | null {
	const run = spawnSyncCaptured(["pgrep", "-P", String(pid)]);
	if (!run.launched) return null;
	if (run.exitCode === 0) return true;
	if (run.exitCode === 1) return false;
	return null;
}

// Git Bash runs a command through a fork helper, so the process it starts is a grandchild of the
// shell; a direct-child filter reports an idle shell while work is still running.
/** The Windows process table, reduced to the parentage the busy walk needs. */
export const WINDOWS_PROCESS_TABLE = [
	"$ErrorActionPreference = 'Stop'",
	"Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId | ConvertTo-Json -Compress",
].join("; ");

interface ProcessRow {
	ProcessId?: number;
	ParentProcessId?: number;
}

/**
 * Whether any process descends from `parent`. Git Bash runs a command through its fork server, so the
 * process a shell starts is often a grandchild rather than a child; walking the table finds both, and
 * a cycle in a hostile table terminates instead of hanging.
 */
export function descendantsOfPid(
	parent: number,
	rows: readonly Pick<ProcessRow, "ProcessId" | "ParentProcessId">[],
): boolean {
	const childrenOf = new Map<number, number[]>();
	for (const row of rows) {
		if (typeof row.ProcessId !== "number" || typeof row.ParentProcessId !== "number") continue;
		const siblings = childrenOf.get(row.ParentProcessId);
		if (siblings) siblings.push(row.ProcessId);
		else childrenOf.set(row.ParentProcessId, [row.ProcessId]);
	}
	const seen = new Set<number>([parent]);
	const queue = [parent];
	while (queue.length > 0) {
		const current = queue.shift() as number;
		for (const child of childrenOf.get(current) ?? []) {
			if (seen.has(child)) continue;
			seen.add(child);
			queue.push(child);
			return true;
		}
	}
	return false;
}

function parseProcessTable(output: string): ProcessRow[] {
	try {
		const parsed = JSON.parse(output) as ProcessRow | ProcessRow[];
		return Array.isArray(parsed) ? parsed : [parsed];
	} catch {
		return [];
	}
}

function childrenViaCim(pid: number): boolean | null {
	for (const shell of ["powershell.exe", "pwsh.exe"]) {
		const run = spawnSyncCaptured([shell, "-NoProfile", "-Command", WINDOWS_PROCESS_TABLE], {
			env: { ...process.env, TR_PARENT_PID: String(pid) },
		});
		if (!run.launched || run.exitCode !== 0) continue;
		return descendantsOfPid(pid, parseProcessTable(run.stdout));
	}
	return null;
}

export function hasChildProcesses(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	if (process.platform === "win32") return childrenViaCim(pid) ?? false;
	return childrenViaProc(pid) ?? childrenViaPgrep(pid) ?? false;
}
