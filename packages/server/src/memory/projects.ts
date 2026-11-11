import { existsSync, mkdirSync } from "node:fs";
import { spawnSyncCaptured } from "@thinkrail/shared/spawn";
import { logger } from "../log";
import { memoryProjectDirName, projectMemoryDir } from "./notes";

const log = logger("memory");
const REGISTER_TIMEOUT_MS = 15_000;

/** Project names this process already registered, so listing never pays the CLI twice. */
const registered = new Set<string>();
/** In-flight registrations, so concurrent list reads share one CLI run. */
const inflight = new Map<string, Promise<void>>();

export interface RegisterProjectOptions {
	/** Test seam: the CLI runner; defaults to a bounded spawn of `basic-memory`. */
	run?: (args: readonly string[]) => { launched: boolean; exitCode: number | null };
}

function runBasicMemory(args: readonly string[]): { launched: boolean; exitCode: number | null } {
	const result = spawnSyncCaptured(["basic-memory", ...args], { timeoutMs: REGISTER_TIMEOUT_MS });
	return { launched: result.launched, exitCode: result.exitCode };
}

/**
 * Registers one project's notes folder as a Basic Memory project, so the agent's MCP server searches
 * the same notes the panel edits. Best-effort: the folder is the product and Markdown is read from
 * disk regardless, so a missing engine or a failing CLI only costs searchability, never the panel.
 * A folder that does not exist yet is created first, because `project add` indexes an existing path.
 */
export function registerProjectMemory(
	project: { slug?: string; name: string },
	options: RegisterProjectOptions = {},
): Promise<void> {
	const name = memoryProjectDirName(project);
	const pending = inflight.get(name);
	if (pending) return pending;
	if (registered.has(name)) return Promise.resolve();
	const run = options.run ?? runBasicMemory;
	const attempt = Promise.resolve()
		.then(() => {
			const dir = projectMemoryDir(project);
			try {
				if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			} catch {
				log.warn(`could not create the notes folder for ${name}`);
				return;
			}
			if (!run(["project", "add", name, dir]).launched) {
				// No engine on PATH: stay retryable, so installing it later registers on the next list.
				log.debug(`basic-memory is not on PATH; ${name} stays unregistered`);
				return;
			}
			// A non-zero exit is normally "already exists" — retrying every list would pay the CLI to
			// learn the same thing, so an executed command counts as settled.
			registered.add(name);
		})
		.catch(() => {})
		.finally(() => {
			if (inflight.get(name) === attempt) inflight.delete(name);
		});
	inflight.set(name, attempt);
	return attempt;
}

/** Test seam: forget what this process registered, so a test can re-run registration. */
export function forgetRegisteredMemoryProjects(): void {
	registered.clear();
	inflight.clear();
}
