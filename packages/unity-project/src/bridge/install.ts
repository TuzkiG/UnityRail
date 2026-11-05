import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stripBom } from "../project/paths.ts";
import {
	EMBEDDED_BRIDGE_PACKAGE_FILES,
	EMBEDDED_BRIDGE_PACKAGE_NAME,
	EMBEDDED_BRIDGE_PACKAGE_VERSION,
} from "./embeddedPackage.ts";

/** Unity's embedded-package folder: a package under `Packages/` is part of the project with no
 * manifest entry, so installing is a copy that also survives version control and offline clones. */
export const BRIDGE_PACKAGE_FOLDER = EMBEDDED_BRIDGE_PACKAGE_NAME;

export interface InstallBridgeResult {
	installed: boolean;
	alreadyInstalled: boolean;
	updated: boolean;
	path: string;
	packageName: string;
	packageVersion: string;
	files: number;
}

export function bridgePackagePath(projectRoot: string): string {
	return join(projectRoot, "Packages", BRIDGE_PACKAGE_FOLDER);
}

export async function installedBridgePackageVersion(projectRoot: string): Promise<string | null> {
	const manifest = join(bridgePackagePath(projectRoot), "package.json");
	if (!existsSync(manifest)) return null;
	try {
		const parsed = JSON.parse(stripBom(await readFile(manifest, "utf8"))) as {
			name?: unknown;
			version?: unknown;
		};
		if (parsed.name !== EMBEDDED_BRIDGE_PACKAGE_NAME) return null;
		return typeof parsed.version === "string" ? parsed.version : null;
	} catch {
		return null;
	}
}

export async function isBridgePackageInstalled(projectRoot: string): Promise<boolean> {
	return (await installedBridgePackageVersion(projectRoot)) !== null;
}

/**
 * Copy the bundled bridge package into the project's embedded packages. Existing files are left alone:
 * a project that already carries the package (committed, or installed by an older build) keeps its copy
 * instead of being silently downgraded.
 */
export async function installBridgePackage(projectRoot: string): Promise<InstallBridgeResult> {
	const target = bridgePackagePath(projectRoot);
	const base = {
		path: target,
		packageName: EMBEDDED_BRIDGE_PACKAGE_NAME,
		packageVersion: EMBEDDED_BRIDGE_PACKAGE_VERSION,
	};
	const installedVersion = await installedBridgePackageVersion(projectRoot);
	if (installedVersion !== null) {
		// Same version: leave the project's copy alone (it may carry local edits). A different version is
		// this app's own package, so refresh it in place and report the update.
		if (installedVersion === EMBEDDED_BRIDGE_PACKAGE_VERSION) {
			return { ...base, installed: true, alreadyInstalled: true, updated: false, files: 0 };
		}
		let updatedFiles = 0;
		for (const [relativePath, content] of Object.entries(EMBEDDED_BRIDGE_PACKAGE_FILES)) {
			const destination = join(target, ...relativePath.split("/"));
			await mkdir(dirname(destination), { recursive: true });
			await writeFile(destination, content, "utf8");
			updatedFiles += 1;
		}
		return {
			...base,
			installed: true,
			alreadyInstalled: false,
			updated: true,
			files: updatedFiles,
		};
	}
	let files = 0;
	for (const [relativePath, content] of Object.entries(EMBEDDED_BRIDGE_PACKAGE_FILES)) {
		const destination = join(target, ...relativePath.split("/"));
		await mkdir(dirname(destination), { recursive: true });
		await writeFile(destination, content, "utf8");
		files += 1;
	}
	return { ...base, installed: true, alreadyInstalled: false, updated: false, files };
}
