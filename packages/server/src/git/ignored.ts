import { gitAsync } from "./gitExec";

const MAX_ARGS_CHARS = 24_000;
const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 256;

const cache = new Map<string, { value: Set<string>; at: number }>();
const flights = new Map<string, Promise<Set<string>>>();

function cacheKey(worktreePath: string, paths: readonly string[]): string {
	return `${worktreePath}\u0000${[...paths].sort().join("\u0000")}`;
}

function argChunks(paths: readonly string[]): string[][] {
	const chunks: string[][] = [];
	let current: string[] = [];
	let length = 0;
	for (const path of paths) {
		if (current.length > 0 && length + path.length + 1 > MAX_ARGS_CHARS) {
			chunks.push(current);
			current = [];
			length = 0;
		}
		current.push(path);
		length += path.length + 1;
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}

async function readIgnored(worktreePath: string, paths: readonly string[]): Promise<Set<string>> {
	const runs = await Promise.all(
		argChunks(paths).map((chunk) =>
			gitAsync(worktreePath, ["-c", "core.quotePath=false", "check-ignore", "--", ...chunk], {
				timeoutMs: TIMEOUT_MS,
				raw: true,
			}),
		),
	);
	const ignored = new Set<string>();
	for (const run of runs) {
		if (!run.ok) continue;
		for (const raw of run.out.split("\n")) {
			const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
			if (line && !line.startsWith('"')) ignored.add(line);
		}
	}
	return ignored;
}

/** Lists the ignored subset of a directory listing, memoized briefly per (repo, listing). */
export async function ignoredPaths(
	worktreePath: string,
	paths: readonly string[],
): Promise<Set<string>> {
	if (paths.length === 0) return new Set();
	const key = cacheKey(worktreePath, paths);
	const cached = cache.get(key);
	if (cached && Date.now() - cached.at < CACHE_TTL_MS) return new Set(cached.value);
	const pending = flights.get(key);
	if (pending) return new Set(await pending);
	const flight = readIgnored(worktreePath, paths)
		.then((value) => {
			if (cache.size >= CACHE_MAX_ENTRIES) {
				const oldest = cache.keys().next().value;
				if (oldest !== undefined) cache.delete(oldest);
			}
			cache.set(key, { value, at: Date.now() });
			return value;
		})
		.finally(() => flights.delete(key));
	flights.set(key, flight);
	return new Set(await flight);
}
