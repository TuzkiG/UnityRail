import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { UnityProjectError } from "./types.ts";

export const UNITY_PROJECT_MARKER = join("ProjectSettings", "ProjectVersion.txt");

// Unity-generated folders that only ever appear at the project root. Inside `Assets/` a folder with
// one of these names is user content and must be walked.
const ROOT_SKIP_DIRECTORIES = new Set([
	"Build",
	"Builds",
	"Library",
	"Logs",
	"MemoryCaptures",
	"Obj",
	"Recordings",
	"Temp",
	"UserSettings",
	"obj",
]);

const ANYWHERE_SKIP_DIRECTORIES = new Set([".git", ".idea", ".vs"]);

const MAX_WALK_FILES = 60_000;
const MAX_WALK_DEPTH = 24;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;

export function isUnityProjectRoot(dir: string): boolean {
	try {
		return statSync(join(dir, UNITY_PROJECT_MARKER)).isFile();
	} catch {
		return false;
	}
}

/** Walk up from `start` until a Unity project root is found. */
export function findUnityProjectRoot(start: string): string | null {
	let current = resolve(start);
	for (let depth = 0; depth < 32; depth += 1) {
		if (isUnityProjectRoot(current)) return current;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
	return null;
}

/**
 * The identity used to compare two paths on this host. Unity and UnityRail can spell the same folder
 * with different separators or drive-letter case.
 */
export function canonicalProjectPath(path: string): string {
	const normalized = resolve(path).replace(/[\\/]+$/, "");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function sameProjectPath(a: string, b: string): boolean {
	return canonicalProjectPath(a) === canonicalProjectPath(b);
}

export function toAssetPath(root: string, absolutePath: string): string {
	return relative(root, absolutePath).split(sep).join("/");
}

/**
 * Unity writes its own files with `Encoding.UTF8`, which emits a BOM. `JSON.parse` and our anchored
 * regexes reject a leading U+FEFF, so every text read drops it.
 */
export function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readTextFile(path: string): string | null {
	try {
		const stat = statSync(path);
		if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) return null;
		return stripBom(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

export function readJsonFile<T>(path: string): T | null {
	const text = readTextFile(path);
	if (text === null) return null;
	try {
		return JSON.parse(text) as T;
	} catch {
		return null;
	}
}

export interface WalkedFile {
	absolutePath: string;
	assetPath: string;
}

export interface UnityWalkResult {
	files: WalkedFile[];
	/** True when the walk stopped at the file or depth bound before exhausting the content. */
	truncated: boolean;
}

/**
 * A bounded, deterministic walk of the folders Unity treats as project content.
 *
 * Symlinks are skipped: a linked folder can escape the project and turn a project read into an
 * unbounded filesystem scan.
 */
export function walkUnityContentBounded(
	root: string,
	options: { includePackages?: boolean; maxFiles?: number } = {},
): UnityWalkResult {
	const roots = [join(root, "Assets")];
	if (options.includePackages === true) roots.push(join(root, "Packages"));
	const maxFiles = options.maxFiles ?? MAX_WALK_FILES;
	const files: WalkedFile[] = [];
	let truncated = false;
	for (const contentRoot of roots) {
		if (!existsSync(contentRoot)) continue;
		walk(contentRoot, 0);
	}
	return { files, truncated };

	function walk(dir: string, depth: number): void {
		if (files.length >= maxFiles) {
			truncated = true;
			return;
		}
		if (depth > MAX_WALK_DEPTH) {
			truncated = true;
			return;
		}
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		entries.sort((a, b) => a.name.localeCompare(b.name));
		for (const entry of entries) {
			if (files.length >= maxFiles) {
				truncated = true;
				return;
			}
			if (entry.isSymbolicLink()) continue;
			const absolutePath = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (depth === 0 && ROOT_SKIP_DIRECTORIES.has(entry.name)) continue;
				if (ANYWHERE_SKIP_DIRECTORIES.has(entry.name)) continue;
				if (entry.name.endsWith("~")) continue;
				walk(absolutePath, depth + 1);
				continue;
			}
			if (!entry.isFile()) continue;
			files.push({ absolutePath, assetPath: toAssetPath(root, absolutePath) });
		}
	}
}

export function walkUnityContent(
	root: string,
	options: { includePackages?: boolean; maxFiles?: number } = {},
): WalkedFile[] {
	return walkUnityContentBounded(root, options).files;
}

export function assertUnityProject(root: string): void {
	if (!isUnityProjectRoot(root)) {
		throw new UnityProjectError(
			"NOT_UNITY_PROJECT",
			`${root} is not a Unity project (missing ${UNITY_PROJECT_MARKER}).`,
		);
	}
}
