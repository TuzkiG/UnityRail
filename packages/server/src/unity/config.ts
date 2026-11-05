import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { UnityProjectModule } from "@thinkrail/contracts";
import { dataDir } from "../persistence";

const FILE = "unity-projects.json";

export interface StoredUnityProjectConfig {
	projectRoot: string | null;
	businessPath: string | null;
	linkTarget: string | null;
	modules: UnityProjectModule[];
}

type Store = Record<string, StoredUnityProjectConfig>;

function storePath(): string {
	return join(dataDir(), FILE);
}

function readStore(): Store {
	try {
		const parsed = JSON.parse(readFileSync(storePath(), "utf8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const store: Store = {};
		for (const [workspaceId, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (!value || typeof value !== "object") continue;
			const record = value as {
				projectRoot?: unknown;
				businessPath?: unknown;
				linkTarget?: unknown;
				modules?: unknown;
			};
			const path = (value: unknown): string | null =>
				typeof value === "string" && value.length > 0 ? value : null;
			const modules = Array.isArray(record.modules) ? record.modules.filter(isModule) : [];
			store[workspaceId] = {
				projectRoot: path(record.projectRoot),
				businessPath: path(record.businessPath),
				linkTarget: path(record.linkTarget),
				modules,
			};
		}
		return store;
	} catch {
		return {};
	}
}

function isModule(value: unknown): value is UnityProjectModule {
	if (!value || typeof value !== "object") return false;
	const module = value as Record<string, unknown>;
	return (
		typeof module.name === "string" &&
		typeof module.path === "string" &&
		(module.kind === "submodule" || module.kind === "repo" || module.kind === "external")
	);
}

function writeStore(store: Store): void {
	mkdirSync(dataDir(), { recursive: true });
	const target = storePath();
	const temporary = `${target}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(store, null, "\t")}\n`);
		renameSync(temporary, target);
	} finally {
		rmSync(temporary, { force: true });
	}
}

export function readConfiguredProject(workspaceId: string): StoredUnityProjectConfig | null {
	return readStore()[workspaceId] ?? null;
}

export function writeConfiguredProject(
	workspaceId: string,
	config: StoredUnityProjectConfig,
): void {
	const store = readStore();
	store[workspaceId] = config;
	writeStore(store);
}

export function forgetConfiguredProject(workspaceId: string): void {
	const store = readStore();
	if (!(workspaceId in store)) return;
	delete store[workspaceId];
	writeStore(store);
}
