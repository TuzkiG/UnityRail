#!/usr/bin/env bun

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseSubcommand } from "./args";
import {
	bundledExtensionFactories,
	bundledSkillsVersion,
	embeddedSkillFiles,
} from "./bundled-extensions.generated";
import { stagingRoot } from "./paths";
import { embeddedRuntimeAssets, runtimeAssetsVersion } from "./runtime-assets.generated";
import { embeddedWebAssets, webAssetsVersion } from "./web-assets.generated";

const STAGE_CONCURRENCY = 24;

let activeWrites = 0;
const writeWaiters: Array<() => void> = [];

async function withWriteSlot<T>(work: () => Promise<T>): Promise<T> {
	if (activeWrites >= STAGE_CONCURRENCY) {
		await new Promise<void>((resolve) => writeWaiters.push(resolve));
	}
	activeWrites += 1;
	try {
		return await work();
	} finally {
		activeWrites -= 1;
		writeWaiters.shift()?.();
	}
}

async function stage(
	kind: string,
	version: string,
	files: { route: string; data: string }[],
): Promise<string> {
	const dir = join(stagingRoot(), kind, version);
	const marker = `${dir}.complete`;
	if (existsSync(marker)) return dir;
	const directories = new Set<string>();
	await Promise.all(
		files.map((file) =>
			withWriteSlot(async () => {
				const dest = join(dir, file.route);
				const parent = dirname(dest);
				if (!directories.has(parent)) {
					mkdirSync(parent, { recursive: true });
					directories.add(parent);
				}
				await Bun.write(dest, Bun.file(file.data));
			}),
		),
	);
	await Bun.write(marker, version);
	return dir;
}

if (parseSubcommand(Bun.argv.slice(2)) === undefined) {
	const [staticDir, skillsDir, runtimeDir] = await Promise.all([
		stage("web", webAssetsVersion, embeddedWebAssets),
		stage("skills", bundledSkillsVersion, embeddedSkillFiles),
		stage("runtime", runtimeAssetsVersion, embeddedRuntimeAssets),
	]);
	const macosTrash = join(runtimeDir, "macos-trash");
	const windowsTrash = join(runtimeDir, "windows-trash.exe");
	if (process.platform !== "win32") chmodSync(macosTrash, 0o755);
	process.env.THINKRAIL_STATIC_DIR ??= staticDir;
	const { registerBundledRuntime } = await import("@thinkrail/server");
	await registerBundledRuntime({
		factories: bundledExtensionFactories,
		skillsDir,
		trashHelpers: { macos: macosTrash, windows: windowsTrash },
	});
}
const { launch } = await import("./bootstrap");
await launch("binary");
