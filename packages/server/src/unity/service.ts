import { type Dirent, existsSync, lstatSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import type {
	UnityAssetResult,
	UnityBridgeInstallResult,
	UnityBridgeStatus,
	UnityBuildRecord,
	UnityBuildTarget,
	UnityCompileStatus,
	UnityConsolePage,
	UnityDoctorReport,
	UnityExternalLink,
	UnityFolderEntry,
	UnityGameObjectInspection,
	UnityHierarchySnapshot,
	UnityInputResult,
	UnityLogLevel,
	UnityMenuResult,
	UnityOpenEditorResult,
	UnityPackageChange,
	UnityPackageList,
	UnityPlayerSettings,
	UnityPlayerSettingsValues,
	UnityPlayModeAction,
	UnityProfilerSnapshot,
	UnityProjectConfig,
	UnityProjectModule,
	UnityProjectSummary,
	UnityPropertyChange,
	UnityQuitResult,
	UnitySceneObjectResult,
	UnityScreenshotPayload,
	UnityStatusSnapshot,
	UnityTestRunStatus,
	UnityUndoResult,
	UnityWorkspaceSnapshot,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	createDirectoryLink,
	detectUnityModules,
	diagnoseUnityWorkspace,
	EMBEDDED_BRIDGE_PACKAGE_VERSION,
	findUnityProjectRoot,
	installBridgePackage,
	installedBridgePackageVersion,
	isUnityProjectRoot,
	linkExists,
	listDirectoryLinks,
	moduleMountPath,
	openUnityProject,
	readUnityBridgeDiscovery,
	readUnityProject,
	removeDirectoryLink,
	type UnityBridgeClient,
	UnityBridgeError,
	UnityProjectError,
	type UnityProjectInfo,
	withUnityBridge,
} from "@thinkrail/unity-project";
import { getWorkspace } from "../workspaces";
import { readConfiguredProject, writeConfiguredProject } from "./config.ts";

const FOLDER_LIST_LIMIT = 300;

function canonicalPath(path: string): string {
	const normalized = normalize(path).replaceAll("\\", "/");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** Immediate child folders of a configured layer root, for linking one of them. */
function listChildFolders(path: string | null): UnityFolderEntry[] {
	if (!path) return [];
	let entries: Dirent[];
	try {
		entries = readdirSync(path, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries
		.filter(
			(entry) => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.endsWith("~"),
		)
		.map((entry) => ({ name: entry.name, path: join(path, entry.name) }))
		.sort((a, b) => a.name.localeCompare(b.name))
		.slice(0, FOLDER_LIST_LIMIT);
}

interface CachedSummary {
	project: UnityProjectSummary;
	builtAt: number;
}

// The project model walks the whole Assets tree, and the panel polls it. A long TTL plus one shared
// in-flight read keeps that walk off the host's hot path: a stall here delays every other request,
// including `session.list`.
const PROJECT_SUMMARY_TTL_MS = 5 * 60_000;
const PROJECT_SCAN_FILE_LIMIT = 20_000;
const summaryCache = new Map<string, CachedSummary>();
const summaryInFlight = new Map<string, Promise<UnityProjectSummary>>();

function cachedProjectSummary(root: string): Promise<UnityProjectSummary> {
	const cached = summaryCache.get(root);
	if (cached && Date.now() - cached.builtAt < PROJECT_SUMMARY_TTL_MS) {
		return Promise.resolve(cached.project);
	}
	const inFlight = summaryInFlight.get(root);
	if (inFlight) return inFlight;
	const pending = Promise.resolve()
		.then(() => {
			const summary = projectSummary(readUnityProject(root, { maxFiles: PROJECT_SCAN_FILE_LIMIT }));
			summaryCache.set(root, { project: summary, builtAt: Date.now() });
			return summary;
		})
		.finally(() => {
			summaryInFlight.delete(root);
		});
	summaryInFlight.set(root, pending);
	return pending;
}

interface CachedStatus {
	at: number;
	bridge: UnityBridgeStatus | null;
	error: { code: string; message: string } | null;
}

// Unity's Editor answers on its main thread; during an import that can take seconds. The panel polls
// every few seconds, so one recent answer (or one recent failure) is reused instead of stacking calls.
const STATUS_TTL_MS = 3_000;
const SNAPSHOT_REQUEST_TIMEOUT_MS = 4_000;
const statusCache = new Map<string, CachedStatus>();
const statusInFlight = new Map<string, Promise<CachedStatus>>();

function cachedBridgeStatus(root: string): Promise<CachedStatus> {
	const cached = statusCache.get(root);
	if (cached && Date.now() - cached.at < STATUS_TTL_MS) return Promise.resolve(cached);
	const inFlight = statusInFlight.get(root);
	if (inFlight) return inFlight;
	const pending = withUnityBridge(root, (client) => client.status(), {
		retryUnavailable: true,
		requestTimeoutMs: SNAPSHOT_REQUEST_TIMEOUT_MS,
	})
		.then((bridge): CachedStatus => ({ at: Date.now(), bridge, error: null }))
		.catch((error: unknown): CachedStatus => {
			const coded = asCodedError(error);
			return {
				at: Date.now(),
				bridge: null,
				error: {
					code: error instanceof UnityBridgeError ? error.code : "BRIDGE_UNAVAILABLE",
					message: coded.message,
				},
			};
		})
		.finally(() => {
			statusInFlight.delete(root);
		});
	statusInFlight.set(root, pending);
	return pending;
}

// A configured root is validated with a marker-file stat, not a full project read: the panel polls
// this path, and only a genuinely missing project should fall back to detection.
const ROOT_CHECK_TTL_MS = 30_000;
const rootChecks = new Map<string, { ok: boolean; at: number }>();

function isConfiguredProjectRoot(path: string): boolean {
	const cached = rootChecks.get(path);
	if (cached && Date.now() - cached.at < ROOT_CHECK_TTL_MS) return cached.ok;
	const ok = isUnityProjectRoot(path);
	rootChecks.set(path, { ok, at: Date.now() });
	if (rootChecks.size > 64) {
		const oldest = rootChecks.keys().next();
		if (!oldest.done) rootChecks.delete(oldest.value);
	}
	return ok;
}

export function unityProjectRoot(workspaceId: string): string | null {
	const configured = readConfiguredProject(workspaceId)?.projectRoot;
	if (configured && isConfiguredProjectRoot(configured)) return configured;
	const workspace = getWorkspace(workspaceId);
	return findUnityProjectRoot(workspace.worktreePath);
}

function normalizeModule(module: UnityProjectModule): UnityProjectModule {
	return {
		name: module.name,
		path: module.path,
		kind: module.kind,
		...(module.gitUrl ? { gitUrl: module.gitUrl } : {}),
		...(module.mountPath ? { mountPath: module.mountPath } : {}),
		...(module.linkType ? { linkType: module.linkType } : {}),
	};
}

export function unityProjectConfig(workspaceId: string): UnityProjectConfig {
	const workspace = getWorkspace(workspaceId);
	const detectedProjectRoot = findUnityProjectRoot(workspace.worktreePath);
	const configured = readConfiguredProject(workspaceId);
	const catalogRoot = configured?.projectRoot ?? detectedProjectRoot;
	let detected: UnityProjectModule[] = [];
	if (catalogRoot) {
		try {
			readUnityProject(catalogRoot, { includeBridge: false });
			detected = detectUnityModules(catalogRoot);
		} catch {
			detected = [];
		}
	}
	const projectRoot = configured?.projectRoot ?? null;
	const externalLinks = catalogRoot ? unityExternalLinks(catalogRoot, detected) : [];
	const rootCanonical = catalogRoot ? canonicalPath(catalogRoot) : null;
	const businessLink = externalLinks.find(
		(link) =>
			(link.type === "junction" || link.type === "symlink") &&
			(rootCanonical === null || !canonicalPath(link.target).startsWith(`${rootCanonical}/`)),
	);
	const derivedBusinessPath = businessLink ? dirname(businessLink.target) : null;
	const configuredBusinessPath = configured?.businessPath ?? null;
	const businessPath =
		businessLink &&
		derivedBusinessPath &&
		(!configuredBusinessPath ||
			!canonicalPath(businessLink.target).startsWith(`${canonicalPath(configuredBusinessPath)}/`))
			? derivedBusinessPath
			: configuredBusinessPath;
	return {
		workspaceId,
		projectRoot,
		businessPath,
		linkTarget: configured?.linkTarget ?? null,
		businessFolders: listChildFolders(businessPath),
		modules: configured?.modules ?? [],
		detected,
		detectedProjectRoot,
		externalLinks,
	};
}

/**
 * What the project already mounts from outside itself: directory links under `Assets/` plus the
 * submodules and nested checkouts it declares.
 */
function unityExternalLinks(
	projectRoot: string,
	detected: readonly UnityProjectModule[],
): UnityExternalLink[] {
	const links: UnityExternalLink[] = listDirectoryLinks(projectRoot);
	// A submodule can itself be mounted as a directory link; the link is the more precise answer.
	const mounted = new Set(links.map((link) => canonicalPath(link.path)));
	for (const module of detected) {
		if (module.kind === "external") continue;
		const path = isAbsolute(module.path) ? module.path : join(projectRoot, module.path);
		if (mounted.has(canonicalPath(path))) continue;
		links.push({
			name: module.name,
			path,
			target: module.gitUrl ?? path,
			type: module.kind,
		});
	}
	return links;
}

export interface UnityProjectConfigUpdate {
	projectRoot?: string | null;
	businessPath?: string | null;
	linkTarget?: string | null;
	modules?: readonly UnityProjectModule[];
}

export function unitySetProjectConfig(
	workspaceId: string,
	update: UnityProjectConfigUpdate,
): UnityProjectConfig {
	const current = readConfiguredProject(workspaceId) ?? {
		projectRoot: null,
		businessPath: null,
		linkTarget: null,
		modules: [],
	};
	const projectRoot = update.projectRoot === undefined ? current.projectRoot : update.projectRoot;
	if (projectRoot !== null) {
		// Refuse a path that is not a Unity project instead of storing a broken link.
		readUnityProject(projectRoot, { includeBridge: false });
	}
	writeConfiguredProject(workspaceId, {
		projectRoot,
		businessPath: update.businessPath === undefined ? current.businessPath : update.businessPath,
		linkTarget: update.linkTarget === undefined ? current.linkTarget : update.linkTarget,
		modules: (update.modules ?? current.modules).map(normalizeModule),
	});
	return unityProjectConfig(workspaceId);
}

function requireUnityProjectRoot(workspaceId: string): string {
	const root = unityProjectRoot(workspaceId);
	if (!root) {
		throw new CodedError(
			"UNITY_NOT_PROJECT",
			"This workspace is not a Unity project. Open a folder containing ProjectSettings/ProjectVersion.txt.",
		);
	}
	return root;
}

function asCodedError(error: unknown): Error {
	if (error instanceof CodedError) return error;
	if (error instanceof UnityBridgeError) {
		const code =
			error.code === "BRIDGE_PROJECT_MISMATCH"
				? "UNITY_PROJECT_MISMATCH"
				: error.code === "NOT_UNITY_PROJECT"
					? "UNITY_NOT_PROJECT"
					: "UNITY_UNAVAILABLE";
		return new CodedError(code, error.message);
	}
	if (error instanceof UnityProjectError) {
		return new CodedError("UNITY_NOT_PROJECT", error.message);
	}
	return error instanceof Error ? error : new Error(String(error));
}

function projectSummary(project: UnityProjectInfo): UnityProjectSummary {
	return {
		root: project.root,
		editorVersion: project.editorVersion,
		productName: project.productName,
		companyName: project.companyName,
		counts: project.counts,
		packages: project.packages.map((pkg) => ({
			name: pkg.name,
			version: pkg.version,
			builtin: pkg.builtin,
		})),
		assemblies: project.assemblyGraph.nodes.map((node) => ({
			name: node.name,
			path: node.path,
			editorOnly: node.editorOnly,
			references: node.resolvedReferences,
			missingReferences: node.missingReferences,
		})),
		scenes: project.scenes,
		prefabs: project.prefabs,
		warnings: project.warnings,
	};
}

export async function unitySnapshot(workspaceId: string): Promise<UnityWorkspaceSnapshot> {
	const root = unityProjectRoot(workspaceId);
	if (!root) {
		return {
			workspaceId,
			isUnityProject: false,
			projectRoot: null,
			bridgeInstalled: false,
			bridgePackageVersion: null,
			bridgePackageStale: false,
			project: null,
			projectError: null,
			bridge: null,
			bridgeError: null,
		};
	}
	let project: UnityProjectSummary | null = null;
	let projectError: { code: string; message: string } | null = null;
	try {
		project = await cachedProjectSummary(root);
	} catch (error) {
		const coded = asCodedError(error);
		projectError = {
			code: error instanceof UnityProjectError ? error.code : "PROJECT_READ_FAILED",
			message: coded.message,
		};
	}
	const status = await cachedBridgeStatus(root);
	const bridge: UnityBridgeStatus | null = status.bridge;
	const bridgeError: { code: string; message: string } | null = status.error;
	const bridgePackageVersion = await installedBridgePackageVersion(root);
	return {
		workspaceId,
		isUnityProject: true,
		projectRoot: root,
		bridgeInstalled: bridgePackageVersion !== null,
		bridgePackageVersion,
		bridgePackageStale:
			bridgePackageVersion !== null && bridgePackageVersion !== EMBEDDED_BRIDGE_PACKAGE_VERSION,
		project,
		projectError,
		bridge,
		bridgeError,
	};
}

/** The ambient read live surfaces poll: the Editor status alone, never the project model. */
export async function unityStatus(workspaceId: string): Promise<UnityStatusSnapshot> {
	const root = unityProjectRoot(workspaceId);
	if (!root) return { isUnityProject: false, bridge: null };
	const status = await cachedBridgeStatus(root);
	return { isUnityProject: true, bridge: status.bridge };
}

export async function unityDoctor(workspaceId: string): Promise<UnityDoctorReport> {
	const root = unityProjectRoot(workspaceId);
	if (!root) {
		throw new CodedError(
			"UNITY_NOT_PROJECT",
			"This workspace is not a Unity project. Open a folder containing ProjectSettings/ProjectVersion.txt.",
		);
	}
	const report = await diagnoseUnityWorkspace(root);
	return {
		root: report.root,
		editorVersion: report.editorVersion,
		productName: report.productName,
		unityInstalled: report.unityInstalled,
		editorPath: report.editorPath,
		bridgeConnected: report.bridgeConnected,
		bridgeMatchesWorkspace: report.bridgeMatchesWorkspace,
		findings: report.findings,
	};
}

export async function unityConsole(
	workspaceId: string,
	params: { since?: number; limit?: number; levels?: UnityLogLevel[] },
): Promise<UnityConsolePage> {
	const root = requireUnityProjectRoot(workspaceId);
	try {
		return await withUnityBridge(
			root,
			(client) =>
				client.console({
					...(params.since === undefined ? {} : { since: params.since }),
					...(params.limit === undefined ? {} : { limit: params.limit }),
					...(params.levels === undefined ? {} : { levels: params.levels }),
				}),
			{ retryUnavailable: true },
		);
	} catch (error) {
		throw asCodedError(error);
	}
}

export async function unityCompile(
	workspaceId: string,
	force = false,
): Promise<UnityCompileStatus> {
	const root = requireUnityProjectRoot(workspaceId);
	try {
		return await withUnityBridge(root, (client) => client.compile({ force }));
	} catch (error) {
		throw asCodedError(error);
	}
}

export async function unityPlaymode(
	workspaceId: string,
	action: UnityPlayModeAction,
): Promise<UnityBridgeStatus> {
	const root = requireUnityProjectRoot(workspaceId);
	try {
		return await withUnityBridge(root, (client) => client.playmode(action));
	} catch (error) {
		throw asCodedError(error);
	}
}

export async function unityScreenshot(
	workspaceId: string,
	view: "game" | "scene" = "game",
	width = 1280,
): Promise<UnityScreenshotPayload> {
	const root = requireUnityProjectRoot(workspaceId);
	try {
		const shot = await withUnityBridge(
			root,
			(client) => client.screenshot(view, { width: Math.min(Math.max(width, 64), 1920) }),
			{ retryUnavailable: true },
		);
		return {
			view: shot.view,
			mimeType: shot.mimeType,
			base64: shot.base64,
			width: shot.width,
			height: shot.height,
			bytes: shot.bytes,
		};
	} catch (error) {
		throw asCodedError(error);
	}
}

export async function unityTests(
	workspaceId: string,
	mode: "edit" | "play" = "edit",
	filter?: string,
): Promise<UnityTestRunStatus> {
	const root = requireUnityProjectRoot(workspaceId);
	try {
		return await withUnityBridge(root, (client) =>
			client.runTests({ mode, ...(filter ? { filter } : {}) }),
		);
	} catch (error) {
		throw asCodedError(error);
	}
}

export async function unityHierarchy(
	workspaceId: string,
	scene?: string,
): Promise<UnityHierarchySnapshot> {
	const root = requireUnityProjectRoot(workspaceId);
	try {
		return await withUnityBridge(root, (client) => client.hierarchy(scene), {
			retryUnavailable: true,
		});
	} catch (error) {
		throw asCodedError(error);
	}
}

export async function unityInspect(
	workspaceId: string,
	path: string,
): Promise<UnityGameObjectInspection> {
	const root = requireUnityProjectRoot(workspaceId);
	try {
		return await withUnityBridge(root, (client) => client.inspect(path), {
			retryUnavailable: true,
		});
	} catch (error) {
		throw asCodedError(error);
	}
}

export async function unityFind(
	workspaceId: string,
	query: string,
	type?: string,
	limit?: number,
): Promise<UnityAssetResult[]> {
	const root = requireUnityProjectRoot(workspaceId);
	try {
		return await withUnityBridge(
			root,
			(client) =>
				client.find(query, {
					...(type ? { type } : {}),
					...(limit === undefined ? {} : { limit }),
				}),
			{ retryUnavailable: true },
		);
	} catch (error) {
		throw asCodedError(error);
	}
}

export async function unityOpen(
	workspaceId: string,
	path: string,
): Promise<{ ok: boolean; path: string }> {
	const root = requireUnityProjectRoot(workspaceId);
	try {
		return await withUnityBridge(root, (client) => client.open(path));
	} catch (error) {
		throw asCodedError(error);
	}
}

export async function unitySelect(workspaceId: string, path: string): Promise<{ ok: boolean }> {
	const root = requireUnityProjectRoot(workspaceId);
	try {
		return await withUnityBridge(root, (client) => client.select(path));
	} catch (error) {
		throw asCodedError(error);
	}
}

export async function unityClearConsole(workspaceId: string): Promise<{ ok: boolean }> {
	const root = requireUnityProjectRoot(workspaceId);
	try {
		return await withUnityBridge(root, (client) => client.clearConsole(), {
			retryUnavailable: true,
		});
	} catch (error) {
		throw asCodedError(error);
	}
}

export async function unityInstallBridge(workspaceId: string): Promise<UnityBridgeInstallResult> {
	const root = requireUnityProjectRoot(workspaceId);
	try {
		return await installBridgePackage(root);
	} catch (error) {
		throw asCodedError(error);
	}
}

export async function unityOpenEditor(workspaceId: string): Promise<UnityOpenEditorResult> {
	const root = requireUnityProjectRoot(workspaceId);
	const discovery = readUnityBridgeDiscovery(root);
	try {
		if (discovery) {
			const status = await withUnityBridge(root, (client) => client.status(), {
				retryUnavailable: true,
			});
			return { started: false, editorPath: status.applicationPath, pid: discovery.pid };
		}
		const launched = openUnityProject(root);
		return { started: launched.started, editorPath: launched.editorPath, pid: launched.pid };
	} catch (error) {
		throw asCodedError(error);
	}
}

/** Windows junctions and POSIX symlinks both report as symlinks through lstat. */
function isDirectoryLinkEntry(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

function linkFailed(sourcePath: string, mountPath: string, error: unknown): CodedError {
	return new CodedError(
		"UNITY_LINK_FAILED",
		`Could not mount ${sourcePath} at ${mountPath}: ${error instanceof Error ? error.message : String(error)}`,
	);
}

/**
 * Attaches an external folder to the project by mounting it under `Assets/`, then records it. This is
 * the one write path: the folder itself is never modified, and Unity imports the mount like any asset.
 */
export function unityLinkModule(
	workspaceId: string,
	name: string,
	sourcePath: string,
): UnityProjectConfig {
	const projectRoot = unityProjectRoot(workspaceId);
	if (!projectRoot) {
		throw new CodedError("UNITY_NOT_PROJECT", "No Unity project is configured for this workspace");
	}
	const mountPath = moduleMountPath(projectRoot, name);
	const existing = listDirectoryLinks(projectRoot).find(
		(link) => canonicalPath(link.path) === canonicalPath(mountPath),
	);
	const sameTarget =
		existing !== undefined && canonicalPath(existing.target) === canonicalPath(sourcePath);
	if (!sameTarget) {
		if (existing) {
			const previousTarget = existing.target;
			if (!removeDirectoryLink(mountPath)) {
				throw new CodedError(
					"UNITY_LINK_FAILED",
					`Could not replace the existing link at ${mountPath}`,
				);
			}
			try {
				createDirectoryLink(sourcePath, mountPath);
			} catch (error) {
				// Put the previous mount back: a failed replacement must not cost the project its link.
				try {
					createDirectoryLink(previousTarget, mountPath);
				} catch {}
				throw linkFailed(sourcePath, mountPath, error);
			}
		} else if (linkExists(mountPath)) {
			// A dangling mount (its target moved or was deleted) is still a link: heal it here instead
			// of refusing every future link forever.
			const healed = !existsSync(mountPath) && removeDirectoryLink(mountPath);
			if (!healed) {
				throw new CodedError("UNITY_LINK_EXISTS", `Assets/${name} already exists in the project`);
			}
			try {
				createDirectoryLink(sourcePath, mountPath);
			} catch (error) {
				throw linkFailed(sourcePath, mountPath, error);
			}
		} else {
			try {
				createDirectoryLink(sourcePath, mountPath);
			} catch (error) {
				throw linkFailed(sourcePath, mountPath, error);
			}
		}
	}
	const current = readConfiguredProject(workspaceId) ?? {
		projectRoot,
		businessPath: null,
		linkTarget: null,
		modules: [],
	};
	const modules = current.modules.filter(
		(module) =>
			canonicalPath(module.path) !== canonicalPath(sourcePath) &&
			(module.mountPath === undefined ||
				canonicalPath(module.mountPath) !== canonicalPath(mountPath)),
	);
	modules.push({
		name,
		path: sourcePath,
		kind: "external",
		mountPath,
		linkType: existing?.type ?? (process.platform === "win32" ? "junction" : "symlink"),
	});
	writeConfiguredProject(workspaceId, {
		...current,
		projectRoot,
		modules: modules.map(normalizeModule),
	});
	return unityProjectConfig(workspaceId);
}

/**
 * Removes a mount from the project and forgets it; the external folder is left intact. `path` is either
 * a module's source folder (its recorded mount is removed) or a directory link the project already had.
 */
export function unityUnlinkModule(workspaceId: string, path: string): UnityProjectConfig {
	const current = readConfiguredProject(workspaceId);
	const module = current?.modules.find((entry) => entry.path === path);
	const mount = module?.mountPath ?? path;
	const underAssets = canonicalPath(mount).startsWith(
		`${canonicalPath(unityProjectRoot(workspaceId) ?? "")}/assets/`,
	);
	if (module?.mountPath || underAssets) {
		// A real project folder is not a link, so it is never removed; a link that fails to go away
		// must surface instead of leaving a record that claims the mount is gone.
		if (isDirectoryLinkEntry(mount) && !removeDirectoryLink(mount)) {
			throw new CodedError("UNITY_UNLINK_FAILED", `Could not remove the link at ${mount}`);
		}
	}
	if (!current) return unityProjectConfig(workspaceId);
	const modules = current.modules.filter((entry) => entry.path !== path);
	writeConfiguredProject(workspaceId, { ...current, modules: modules.map(normalizeModule) });
	return unityProjectConfig(workspaceId);
}

function requireConfirm(confirm: boolean | undefined): void {
	if (confirm === true) return;
	throw new CodedError(
		"UNITY_CONFIRM_REQUIRED",
		"This action changes the Editor or the project; ask the user and pass confirm: true to proceed.",
	);
}

function unityWrite<T>(
	workspaceId: string,
	run: (client: UnityBridgeClient) => Promise<T>,
): Promise<T> {
	const root = requireUnityProjectRoot(workspaceId);
	return withUnityBridge(root, run).catch((error: unknown) => {
		throw asCodedError(error);
	});
}

export function unityCreateObject(
	workspaceId: string,
	input: { name: string; parent?: string; components?: string[]; save?: boolean },
): Promise<UnitySceneObjectResult> {
	return unityWrite(workspaceId, (client) => client.createObject(input));
}

export async function unityDeleteObject(
	workspaceId: string,
	input: { path: string; save?: boolean; confirm?: boolean },
): Promise<UnitySceneObjectResult> {
	requireConfirm(input.confirm);
	return unityWrite(workspaceId, (client) =>
		client.deleteObject(input.path, { ...(input.save === undefined ? {} : { save: input.save }) }),
	);
}

export function unityAddComponent(
	workspaceId: string,
	input: { path: string; component: string; save?: boolean },
): Promise<UnitySceneObjectResult> {
	return unityWrite(workspaceId, (client) =>
		client.addComponent(input.path, input.component, {
			...(input.save === undefined ? {} : { save: input.save }),
		}),
	);
}

export async function unityRemoveComponent(
	workspaceId: string,
	input: { path: string; component: string; index?: number; save?: boolean; confirm?: boolean },
): Promise<UnitySceneObjectResult> {
	requireConfirm(input.confirm);
	return unityWrite(workspaceId, (client) =>
		client.removeComponent(input.path, input.component, {
			...(input.index === undefined ? {} : { index: input.index }),
			...(input.save === undefined ? {} : { save: input.save }),
		}),
	);
}

export function unitySetProperty(
	workspaceId: string,
	input: {
		path: string;
		component: string;
		property: string;
		value: unknown;
		index?: number;
		save?: boolean;
	},
): Promise<UnityPropertyChange> {
	return unityWrite(workspaceId, (client) => client.setProperty(input));
}

export function unitySaveScene(
	workspaceId: string,
	path?: string,
): Promise<{ ok: boolean; path: string }> {
	return unityWrite(workspaceId, (client) => client.saveScene({ ...(path ? { path } : {}) }));
}

export function unityUndo(workspaceId: string, steps = 1): Promise<UnityUndoResult> {
	return unityWrite(workspaceId, (client) => client.undo(steps));
}

export async function unityExecuteMenu(
	workspaceId: string,
	item: string,
	confirm: boolean,
): Promise<UnityMenuResult> {
	requireConfirm(confirm);
	return unityWrite(workspaceId, (client) => client.executeMenu(item));
}

export function unityProfiler(workspaceId: string): Promise<UnityProfilerSnapshot> {
	return unityWrite(workspaceId, (client) => client.profilerSnapshot());
}

export function unityQueueInput(
	workspaceId: string,
	keys: readonly string[],
	releaseAll = false,
): Promise<UnityInputResult> {
	return unityWrite(workspaceId, (client) => client.queueInput(keys, { releaseAll }));
}

export async function unityQuitEditor(
	workspaceId: string,
	options: { save?: boolean; discard?: boolean },
	confirm: boolean,
): Promise<UnityQuitResult> {
	requireConfirm(confirm);
	return unityWrite(workspaceId, (client) => client.quitEditor(options));
}

export async function unityStartBuild(
	workspaceId: string,
	options: {
		target?: UnityBuildTarget;
		outputPath?: string;
		scenes?: string[];
		development?: boolean;
	},
	confirm: boolean,
): Promise<UnityBuildRecord> {
	requireConfirm(confirm);
	return unityWrite(workspaceId, (client) => client.startBuild(options));
}

export function unityBuildStatus(workspaceId: string, buildId: string): Promise<UnityBuildRecord> {
	return unityWrite(workspaceId, (client) => client.waitForBuild(buildId, { timeoutMs: 5_000 }));
}

export function unityListPackages(workspaceId: string): Promise<UnityPackageList> {
	return unityWrite(workspaceId, (client) => client.listPackages());
}

export async function unityChangePackage(
	workspaceId: string,
	action: "add" | "remove",
	id: string,
	confirm: boolean,
): Promise<UnityPackageChange> {
	requireConfirm(confirm);
	return unityWrite(workspaceId, (client) => client.changePackage(action, id));
}

export function unityReadSettings(workspaceId: string): Promise<UnityPlayerSettings> {
	return unityWrite(workspaceId, (client) => client.readSettings());
}

export async function unityWriteSettings(
	workspaceId: string,
	settings: Partial<UnityPlayerSettingsValues> & { platform?: string },
	confirm: boolean,
): Promise<UnityPlayerSettings> {
	requireConfirm(confirm);
	return unityWrite(workspaceId, (client) => client.writeSettings(settings));
}
