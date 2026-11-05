import {
	existsSync,
	lstatSync,
	readdirSync,
	realpathSync,
	rmdirSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { join } from "node:path";
import type { UnityExternalLink, UnityLinkType } from "@thinkrail/contracts";

const WINDOWS = process.platform === "win32";

/**
 * Node exposes a junction and a directory symlink identically through `lstat`, so the runtime only
 * distinguishes "directory link" from "not a link". Windows projects get junctions because that is
 * what `symlinkSync` can create without Developer Mode.
 */
function linkType(): UnityLinkType {
	return WINDOWS ? "junction" : "symlink";
}

function isDirectoryLink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

/** External folders the project already mounts under `Assets/`. */
export function listDirectoryLinks(projectRoot: string): UnityExternalLink[] {
	const assets = join(projectRoot, "Assets");
	if (!existsSync(assets)) return [];
	const links: UnityExternalLink[] = [];
	for (const entry of readdirSync(assets, { withFileTypes: true })) {
		if (entry.name.startsWith(".") || entry.name.endsWith("~")) continue;
		const path = join(assets, entry.name);
		if (!isDirectoryLink(path)) continue;
		let target = "";
		try {
			target = realpathSync(path);
		} catch {
			continue;
		}
		links.push({ name: entry.name, path, target, type: linkType() });
	}
	return links;
}

export function linkExists(linkPath: string): boolean {
	return existsSync(linkPath) || isDirectoryLink(linkPath);
}

/** Mounts an external folder inside the project so the Editor imports it. */
export function createDirectoryLink(target: string, linkPath: string): void {
	if (!existsSync(target)) {
		throw new Error(`Link target does not exist: ${target}`);
	}
	if (linkExists(linkPath)) {
		throw new Error(`Link path already exists: ${linkPath}`);
	}
	symlinkSync(target, linkPath, WINDOWS ? "junction" : "dir");
}

/** Removes the link only; the external folder it pointed at is never touched. */
export function removeDirectoryLink(linkPath: string): boolean {
	if (!isDirectoryLink(linkPath)) return false;
	try {
		unlinkSync(linkPath);
		return true;
	} catch {
		// A Windows junction is a directory entry, so it is removed with `rmdir`.
	}
	try {
		rmdirSync(linkPath);
		return true;
	} catch {
		return false;
	}
}

/** `Assets/<name>` for an external folder, kept inside the project. */
export function moduleMountPath(projectRoot: string, name: string): string {
	const safe =
		name
			.replace(/[\\/:*?"<>|]/g, "-")
			// Windows rejects trailing dots and spaces; a leading dot would hide the folder from Unity.
			.replace(/^\.+/, "")
			.replace(/[. ]+$/, "")
			.trim() || "Module";
	return join(projectRoot, "Assets", safe);
}
