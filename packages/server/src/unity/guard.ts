import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { UnityGuardFinding, UnityGuardReport } from "@thinkrail/contracts";
import { buildGuidIndex } from "@thinkrail/unity-project";
import { getWorkspace } from "../workspaces";
import { unityProjectRoot } from "./service.ts";

const LARGE_ASSET_BYTES = 2 * 1024 * 1024;
const MAX_FINDINGS = 40;

function toPosix(path: string): string {
	return path.replaceAll("\\", "/");
}

function assetPathInProject(
	projectRoot: string,
	worktreePath: string,
	path: string,
): string | null {
	const absolute = join(worktreePath, ...path.split("/"));
	const inside = toPosix(relative(projectRoot, absolute));
	if (inside.startsWith("../") || inside === "..") return null;
	if (!inside.startsWith("Assets/")) return null;
	return inside;
}

function readGuid(metaPath: string): string | null {
	try {
		const text = readFileSync(metaPath, "utf8");
		return /^\s*guid:\s*([0-9a-fA-F]{32})\s*$/m.exec(text)?.[1]?.toLowerCase() ?? null;
	} catch {
		return null;
	}
}

/** LFS rules from every `.gitattributes` in the worktree root and the project root. */
function lfsPatterns(worktreePath: string, projectRoot: string): RegExp[] {
	const patterns: RegExp[] = [];
	const seen = new Set<string>();
	for (const root of [worktreePath, projectRoot]) {
		const file = join(root, ".gitattributes");
		if (seen.has(file)) continue;
		seen.add(file);
		let text: string;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		for (const line of text.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (trimmed === "" || trimmed.startsWith("#")) continue;
			const [glob = "", ...attributes] = trimmed.split(/\s+/);
			if (glob === "" || glob.startsWith("!")) continue;
			if (!attributes.some((attribute) => attribute.toLowerCase() === "filter=lfs")) continue;
			patterns.push(globToRegExp(glob));
		}
	}
	return patterns;
}

function globToRegExp(glob: string): RegExp {
	let out = "";
	for (let index = 0; index < glob.length; index += 1) {
		const char = glob[index] ?? "";
		if (char === "*") {
			if (glob[index + 1] === "*") {
				out += ".*";
				index += 1;
				if (glob[index + 1] === "/") index += 1;
			} else {
				out += "[^/]*";
			}
			continue;
		}
		if (char === "?") {
			out += "[^/]";
			continue;
		}
		out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${out}$`, "i");
}

function hasLfsRule(patterns: readonly RegExp[], projectRelative: string): boolean {
	const base = projectRelative.slice(projectRelative.lastIndexOf("/") + 1);
	return patterns.some((pattern) => pattern.test(projectRelative) || pattern.test(base));
}

function gitAttributesMentionsUnityMerge(worktreePath: string): boolean {
	try {
		const text = readFileSync(join(worktreePath, ".gitattributes"), "utf8");
		return /unityyamlmerge/i.test(text);
	} catch {
		return false;
	}
}

function gitIgnoreCoversUnityNoise(worktreePath: string, projectRoot: string): boolean {
	const projectRelative = toPosix(relative(worktreePath, projectRoot));
	const prefix = projectRelative === "" ? "" : `${projectRelative}/`;
	for (const candidate of [join(worktreePath, ".gitignore"), join(projectRoot, ".gitignore")]) {
		let text: string;
		try {
			text = readFileSync(candidate, "utf8");
		} catch {
			continue;
		}
		const lines = text.split(/\r?\n/).map((line) => line.trim().replace(/^\/+/, ""));
		if (
			lines.some(
				(line) =>
					line === "Library/" ||
					line === "Library" ||
					line === `${prefix}Library/` ||
					line === `${prefix}Library`,
			)
		) {
			return true;
		}
	}
	return false;
}

/**
 * Checks the changed files of a Unity project for the mistakes that silently corrupt a game: an asset
 * without its `.meta`, a duplicated GUID, a large binary that never reached LFS, and a repository that
 * would merge scenes as text.
 */
export function unityAssetGuard(
	workspaceId: string,
	changedPaths: readonly string[],
): UnityGuardReport {
	const findings: UnityGuardFinding[] = [];
	const checkedAt = Date.now();
	const workspace = getWorkspace(workspaceId);
	const projectRoot = unityProjectRoot(workspaceId);
	if (!projectRoot) return { findings, checkedAt, checkedPaths: 0 };
	const worktreePath = workspace.worktreePath;
	const relevant = changedPaths.filter(
		(path) => assetPathInProject(projectRoot, worktreePath, path) !== null,
	);
	const changed = new Set(relevant);
	let index: ReturnType<typeof buildGuidIndex> | null = null;
	const lfs = relevant.length > 0 ? lfsPatterns(worktreePath, projectRoot) : [];

	for (const path of relevant) {
		if (findings.length >= MAX_FINDINGS) break;
		const projectRelative = assetPathInProject(projectRoot, worktreePath, path);
		if (projectRelative === null) continue;
		const absolute = join(worktreePath, ...path.split("/"));
		if (path.endsWith(".meta")) {
			const asset = absolute.slice(0, -".meta".length);
			if (!existsSync(asset)) {
				findings.push({ code: "ORPHAN_META", severity: "warning", path });
			}
			const guid = readGuid(absolute);
			if (guid !== null) {
				index ??= buildGuidIndex(projectRoot);
				const changedAsset = projectRelative.slice(0, -".meta".length);
				for (const [candidatePath, candidateGuid] of index.byPath) {
					if (candidateGuid !== guid || candidatePath === changedAsset) continue;
					findings.push({
						code: "DUPLICATE_GUID",
						severity: "error",
						path,
						detail: `${guid} → ${candidatePath}`,
					});
					break;
				}
			}
			continue;
		}
		if (!existsSync(absolute)) continue;
		if (!existsSync(`${absolute}.meta`) && !changed.has(`${path}.meta`)) {
			findings.push({ code: "MISSING_META", severity: "error", path });
			continue;
		}
		let size = 0;
		try {
			size = statSync(absolute).size;
		} catch {
			continue;
		}
		if (size < LARGE_ASSET_BYTES) continue;
		if (!hasLfsRule(lfs, projectRelative)) {
			findings.push({
				code: "LARGE_ASSET",
				severity: "warning",
				path,
				detail: `${Math.round(size / (1024 * 1024))} MiB`,
			});
		}
	}
	if (!gitAttributesMentionsUnityMerge(worktreePath)) {
		findings.push({ code: "MERGE_DRIVER_MISSING", severity: "warning" });
	}
	if (!gitIgnoreCoversUnityNoise(worktreePath, projectRoot)) {
		findings.push({ code: "IGNORE_MISSING", severity: "warning" });
	}
	return { findings: findings.slice(0, MAX_FINDINGS), checkedAt, checkedPaths: relevant.length };
}
