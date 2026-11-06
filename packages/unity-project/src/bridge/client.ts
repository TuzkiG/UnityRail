import {
	bridgeProjectMatches,
	isBridgeProtocolSupported,
	readUnityBridgeDiscovery,
} from "./discovery.ts";
import {
	UNITY_BRIDGE_PROTOCOL_VERSION,
	type UnityAssetResult,
	type UnityBridgeDiscovery,
	type UnityBridgeStatus,
	type UnityBuildRecord,
	type UnityBuildTarget,
	type UnityCompileState,
	type UnityCompileStatus,
	type UnityConsoleEntry,
	type UnityConsolePage,
	type UnityDiagnostic,
	type UnityEditorTool,
	type UnityEditorToolResult,
	type UnityGameObjectInspection,
	type UnityHierarchyNode,
	type UnityHierarchySnapshot,
	type UnityInputResult,
	type UnityLogLevel,
	type UnityMenuResult,
	type UnityPackageChange,
	type UnityPackageInfo,
	type UnityPackageList,
	type UnityPlayerSettings,
	type UnityPlayerSettingsValues,
	type UnityPlayModeAction,
	type UnityProfilerMarker,
	type UnityProfilerSnapshot,
	type UnityPropertyChange,
	type UnityQuitResult,
	type UnitySceneObjectResult,
	type UnitySelectionEntry,
	type UnityTestResult,
	type UnityTestRunState,
	type UnityTestRunStatus,
	type UnityUndoResult,
} from "./protocol.ts";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_COMPILE_TIMEOUT_MS = 240_000;
const DEFAULT_TEST_TIMEOUT_MS = 600_000;
const DEFAULT_BUILD_TIMEOUT_MS = 1_800_000;
const POLL_INTERVAL_MS = 400;

export type UnityBridgeErrorCode =
	| "NOT_UNITY_PROJECT"
	| "BRIDGE_NOT_RUNNING"
	| "BRIDGE_UNAVAILABLE"
	| "BRIDGE_PROTOCOL_MISMATCH"
	| "BRIDGE_PROJECT_MISMATCH"
	| "BRIDGE_AUTH"
	| "BRIDGE_HTTP"
	| "BRIDGE_TIMEOUT"
	| "UNITY_INSTALL_NOT_FOUND"
	| "INVALID_ARGUMENT";

export class UnityBridgeError extends Error {
	readonly code: UnityBridgeErrorCode;
	readonly status: number | undefined;
	readonly detail: string | undefined;

	constructor(
		code: UnityBridgeErrorCode,
		message: string,
		options: { status?: number; detail?: string; cause?: unknown } = {},
	) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = "UnityBridgeError";
		this.code = code;
		this.status = options.status;
		this.detail = options.detail;
	}
}

export interface UnityBridgeConnection {
	projectRoot: string;
	discovery: UnityBridgeDiscovery;
	client: UnityBridgeClient;
}

export interface UnityBridgeConnectionOptions {
	homeDir?: string;
	requestTimeoutMs?: number;
	signal?: AbortSignal | undefined;
	retryUnavailable?: boolean;
}

export interface UnityCompileOptions {
	force?: boolean;
	timeoutMs?: number;
	signal?: AbortSignal | undefined;
}

export interface UnityConsoleOptions {
	since?: number;
	limit?: number;
	levels?: UnityLogLevel[];
	signal?: AbortSignal | undefined;
}

export interface UnityTestOptions {
	mode: "edit" | "play";
	filter?: string;
	timeoutMs?: number;
	signal?: AbortSignal | undefined;
}

export type UnityScreenshotView = "game" | "scene";

export interface UnityScreenshot {
	view: UnityScreenshotView;
	mimeType: "image/png";
	base64: string;
	bytes: number;
	width: number;
	height: number;
}

export async function connectUnityBridge(
	projectRoot: string,
	options: UnityBridgeConnectionOptions = {},
): Promise<UnityBridgeConnection> {
	const discovery = readUnityBridgeDiscovery(projectRoot, options.homeDir);
	if (!discovery) {
		throw new UnityBridgeError(
			"BRIDGE_NOT_RUNNING",
			`The Unity bridge is not running for ${projectRoot}. Open this project in Unity with com.thinkrail.bridge installed, then choose Tools > UnityRail > Start Unity Bridge.`,
		);
	}
	if (!isBridgeProtocolSupported(discovery)) throw protocolMismatchError(discovery);
	if (!bridgeProjectMatches(discovery, projectRoot)) {
		throw new UnityBridgeError(
			"BRIDGE_PROJECT_MISMATCH",
			`The open Unity Editor has ${discovery.projectPath} loaded, not ${projectRoot}. Open this workspace in Unity, or use the workspace Unity has open.`,
		);
	}
	const client = new UnityBridgeClient(discovery, {
		...(options.requestTimeoutMs === undefined
			? {}
			: { requestTimeoutMs: options.requestTimeoutMs }),
		...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
	});
	return { projectRoot, discovery, client };
}

/**
 * Run one operation against the workspace's bridge. Only read-only callers set `retryUnavailable`: a
 * domain reload changes the port and token, so one rediscovery is safe for a read. Writes never retry,
 * because replaying a non-idempotent action after an ambiguous failure can double it.
 */
export async function withUnityBridge<T>(
	projectRoot: string,
	operation: (client: UnityBridgeClient) => Promise<T>,
	options: UnityBridgeConnectionOptions = {},
): Promise<T> {
	const connection = await connectUnityBridge(projectRoot, options);
	try {
		return await operation(connection.client);
	} catch (error) {
		if (
			options.retryUnavailable !== true ||
			!(error instanceof UnityBridgeError) ||
			error.code !== "BRIDGE_UNAVAILABLE"
		) {
			throw error;
		}
		const refreshed = await connectUnityBridge(projectRoot, options);
		return operation(refreshed.client);
	}
}

const BUILD_STATES: readonly UnityBuildRecord["state"][] = ["running", "succeeded", "failed"];

function normalizeBuildRecord(value: unknown): UnityBuildRecord {
	const raw = objectValue(value);
	const state = BUILD_STATES.includes(raw.state as UnityBuildRecord["state"])
		? (raw.state as UnityBuildRecord["state"])
		: "failed";
	const errors = Array.isArray(raw.errors)
		? raw.errors.filter((entry): entry is string => typeof entry === "string")
		: [];
	return {
		buildId: stringValue(raw.buildId),
		state,
		target: stringValue(raw.target),
		outputPath: stringValue(raw.outputPath),
		startedAt: stringValue(raw.startedAt),
		...(optionalString(raw.finishedAt) === undefined
			? {}
			: { finishedAt: stringValue(raw.finishedAt) }),
		...(optionalNumber(raw.durationMs) === undefined
			? {}
			: { durationMs: numberValue(raw.durationMs) }),
		...(optionalNumber(raw.totalSize) === undefined
			? {}
			: { totalSize: numberValue(raw.totalSize) }),
		...(optionalString(raw.result) === undefined ? {} : { result: stringValue(raw.result) }),
		errors,
		...(optionalString(raw.error) === undefined ? {} : { error: stringValue(raw.error) }),
	};
}

function normalizePackageList(value: unknown): UnityPackageList {
	const raw = objectValue(value);
	const packages = Array.isArray(raw.packages)
		? raw.packages.map((entry): UnityPackageInfo => {
				const item = objectValue(entry);
				return {
					name: stringValue(item.name),
					...(optionalString(item.displayName) === undefined
						? {}
						: { displayName: stringValue(item.displayName) }),
					version: stringValue(item.version),
					source: stringValue(item.source, "unknown"),
					...(typeof item.direct === "boolean" ? { direct: item.direct } : {}),
				};
			})
		: [];
	return {
		packages,
		...(typeof raw.pending === "boolean" ? { pending: raw.pending } : {}),
		...(optionalString(raw.error) === undefined ? {} : { error: stringValue(raw.error) }),
	};
}

function normalizePlayerSettings(value: unknown): UnityPlayerSettings {
	const raw = objectValue(value);
	const values = objectValue(raw.values);
	return {
		platform: stringValue(raw.platform),
		values: {
			productName: stringValue(values.productName),
			companyName: stringValue(values.companyName),
			bundleVersion: stringValue(values.bundleVersion),
			applicationIdentifier: stringValue(values.applicationIdentifier),
			runInBackground: values.runInBackground === true,
			defaultScreenWidth: numberValue(values.defaultScreenWidth),
			defaultScreenHeight: numberValue(values.defaultScreenHeight),
			fullscreenMode: stringValue(values.fullscreenMode),
			resizableWindow: values.resizableWindow === true,
		},
		...(Array.isArray(raw.allowed)
			? {
					allowed: raw.allowed.filter((entry): entry is string => typeof entry === "string"),
				}
			: {}),
	};
}

function normalizeProfilerSnapshot(value: unknown): UnityProfilerSnapshot {
	const raw = objectValue(value);
	const markers = Array.isArray(raw.markers)
		? raw.markers.map((entry): UnityProfilerMarker => {
				const item = objectValue(entry);
				return {
					name: stringValue(item.name),
					category: stringValue(item.category),
					unit: stringValue(item.unit),
					value: numberValue(item.value),
				};
			})
		: [];
	return {
		frame: numberValue(raw.frame),
		isPlaying: raw.isPlaying === true,
		markers,
	};
}

function normalizeEditorTools(value: unknown): UnityEditorTool[] {
	const raw = objectValue(value);
	const tools = Array.isArray(raw.tools) ? raw.tools : [];
	return tools.flatMap((entry): UnityEditorTool[] => {
		if (!entry || typeof entry !== "object") return [];
		const tool = entry as Record<string, unknown>;
		const name = stringValue(tool.name);
		if (name.length === 0) return [];
		return [
			{
				name,
				description: stringValue(tool.description),
				...(typeof tool.parameters === "string" && tool.parameters.length > 0
					? { parameters: tool.parameters }
					: {}),
			},
		];
	});
}

function normalizeSceneObject(value: unknown): UnitySceneObjectResult {
	const raw = objectValue(value);
	return {
		ok: raw.ok === true,
		path: stringValue(raw.path),
		...(optionalNumber(raw.instanceId) === undefined
			? {}
			: { instanceId: numberValue(raw.instanceId) }),
		...(typeof raw.created === "boolean" ? { created: raw.created } : {}),
		...(Array.isArray(raw.components)
			? {
					components: raw.components.filter((entry): entry is string => typeof entry === "string"),
				}
			: {}),
		...(typeof raw.added === "boolean" ? { added: raw.added } : {}),
		...(typeof raw.saved === "boolean" ? { saved: raw.saved } : {}),
	};
}

function normalizePropertyChange(value: unknown): UnityPropertyChange {
	const raw = objectValue(value);
	return {
		ok: raw.ok === true,
		path: stringValue(raw.path),
		component: stringValue(raw.component),
		property: stringValue(raw.property),
		before: stringValue(raw.before),
		after: stringValue(raw.after),
		...(typeof raw.saved === "boolean" ? { saved: raw.saved } : {}),
	};
}

export class UnityBridgeClient {
	discovery: UnityBridgeDiscovery;
	private readonly requestTimeoutMs: number;
	private readonly homeDir: string | undefined;
	private baseUrl: string;

	constructor(
		discovery: UnityBridgeDiscovery,
		options: { requestTimeoutMs?: number; homeDir?: string } = {},
	) {
		this.discovery = discovery;
		this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		this.homeDir = options.homeDir;
		this.baseUrl = `http://127.0.0.1:${discovery.port}`;
	}

	async status(signal?: AbortSignal): Promise<UnityBridgeStatus> {
		return normalizeBridgeStatus(
			await this.requestJson<unknown>("/v1/status", { ...(signal ? { signal } : {}) }),
		);
	}

	async compile(options: UnityCompileOptions = {}): Promise<UnityCompileStatus> {
		const started = await this.requestJson<{ compileId: number; state: string }>("/v1/compile", {
			method: "POST",
			body: { force: options.force === true },
			...(options.signal ? { signal: options.signal } : {}),
		});
		return this.waitForCompile(started.compileId, options);
	}

	async waitForCompile(
		compileId: number,
		options: UnityCompileOptions = {},
	): Promise<UnityCompileStatus> {
		const timeoutMs = options.timeoutMs ?? DEFAULT_COMPILE_TIMEOUT_MS;
		return this.poll(
			async () => (await this.status(options.signal)).lastCompile ?? undefined,
			(compile) => compile.id === compileId && compile.state !== "compiling",
			Date.now() + timeoutMs,
			`Unity did not finish compiling within ${Math.round(timeoutMs / 1000)}s.`,
			options.signal,
		);
	}

	async console(options: UnityConsoleOptions = {}): Promise<UnityConsolePage> {
		const params = new URLSearchParams();
		if (options.since !== undefined) params.set("since", String(options.since));
		if (options.limit !== undefined) params.set("limit", String(options.limit));
		if (options.levels !== undefined && options.levels.length > 0) {
			params.set("levels", options.levels.join(","));
		}
		const query = params.size > 0 ? `?${params.toString()}` : "";
		return normalizeConsolePage(
			await this.requestJson<unknown>(`/v1/console${query}`, {
				...(options.signal ? { signal: options.signal } : {}),
			}),
		);
	}

	async clearConsole(signal?: AbortSignal): Promise<{ ok: boolean }> {
		return this.requestJson("/v1/console", {
			method: "DELETE",
			...(signal ? { signal } : {}),
		});
	}

	async playmode(action: UnityPlayModeAction, signal?: AbortSignal): Promise<UnityBridgeStatus> {
		return this.requestJson("/v1/playmode", {
			method: "POST",
			body: { action },
			...(signal ? { signal } : {}),
		});
	}

	async screenshot(
		view: UnityScreenshotView = "game",
		options: { width?: number; signal?: AbortSignal | undefined } = {},
	): Promise<UnityScreenshot> {
		const params = new URLSearchParams({ view });
		if (options.width !== undefined) params.set("width", String(options.width));
		const response = await this.fetch(`/v1/screenshot?${params.toString()}`, {
			...(options.signal ? { signal: options.signal } : {}),
		});
		if (!response.ok) throw await this.httpError(response);
		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.startsWith("image/")) {
			throw new UnityBridgeError("BRIDGE_HTTP", "Unity returned a non-image screenshot.", {
				status: response.status,
				detail: await safeText(response),
			});
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		const base64 = Buffer.from(bytes).toString("base64");
		const dimensions = pngDimensions(bytes);
		return {
			view,
			mimeType: "image/png",
			base64,
			bytes: bytes.byteLength,
			width: dimensions.width,
			height: dimensions.height,
		};
	}

	async runTests(options: UnityTestOptions): Promise<UnityTestRunStatus> {
		const started = await this.requestJson<unknown>("/v1/tests", {
			method: "POST",
			body: { mode: options.mode, ...(options.filter ? { filter: options.filter } : {}) },
			...(options.signal ? { signal: options.signal } : {}),
		});
		const runId = stringValue(objectValue(started).runId);
		if (runId.length === 0) {
			throw new UnityBridgeError("BRIDGE_HTTP", "Unity did not return a test run id.");
		}
		const timeoutMs = options.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;
		return this.poll(
			async () => {
				const status = normalizeTestRunStatus(
					await this.requestJson<unknown>(`/v1/tests/status?id=${encodeURIComponent(runId)}`, {
						...(options.signal ? { signal: options.signal } : {}),
					}),
				);
				return status.state === "running" ? undefined : status;
			},
			() => true,
			Date.now() + timeoutMs,
			`Unity tests did not finish within ${Math.round(timeoutMs / 1000)}s.`,
			options.signal,
		);
	}

	async hierarchy(scene?: string, signal?: AbortSignal): Promise<UnityHierarchySnapshot> {
		const query = scene ? `?scene=${encodeURIComponent(scene)}` : "";
		return normalizeHierarchySnapshot(
			await this.requestJson<unknown>(`/v1/hierarchy${query}`, {
				...(signal ? { signal } : {}),
			}),
		);
	}

	async inspect(path: string, signal?: AbortSignal): Promise<UnityGameObjectInspection> {
		return this.requestJson(`/v1/inspect?path=${encodeURIComponent(path)}`, {
			...(signal ? { signal } : {}),
		});
	}

	async find(
		query: string,
		options: { type?: string; limit?: number; signal?: AbortSignal | undefined } = {},
	): Promise<UnityAssetResult[]> {
		const params = new URLSearchParams({ query });
		if (options.type) params.set("type", options.type);
		if (options.limit !== undefined) params.set("limit", String(options.limit));
		return this.requestJson(`/v1/find?${params.toString()}`, {
			...(options.signal ? { signal: options.signal } : {}),
		});
	}

	async open(path: string, signal?: AbortSignal): Promise<{ ok: boolean; path: string }> {
		return this.requestJson("/v1/open", {
			method: "POST",
			body: { path },
			...(signal ? { signal } : {}),
		});
	}

	async select(path: string, signal?: AbortSignal): Promise<{ ok: boolean }> {
		return this.requestJson("/v1/select", {
			method: "POST",
			body: { path },
			...(signal ? { signal } : {}),
		});
	}

	async createObject(
		input: {
			name: string;
			parent?: string;
			components?: string[];
			save?: boolean;
			ensure?: boolean;
		},
		signal?: AbortSignal,
	): Promise<UnitySceneObjectResult> {
		const body = {
			name: input.name,
			...(input.parent ? { parent: input.parent } : {}),
			...(input.components ? { components: input.components } : {}),
			...(input.save === true ? { save: true } : {}),
			...(input.ensure === true ? { ensure: true } : {}),
		};
		return normalizeSceneObject(
			await this.requestJson<unknown>("/v1/scene/object", {
				method: "POST",
				body,
				...(signal ? { signal } : {}),
			}),
		);
	}

	async deleteObject(
		path: string,
		options: { save?: boolean; signal?: AbortSignal | undefined } = {},
	): Promise<UnitySceneObjectResult> {
		return normalizeSceneObject(
			await this.requestJson<unknown>("/v1/scene/object", {
				method: "DELETE",
				body: { path, ...(options.save === true ? { save: true } : {}) },
				...(options.signal ? { signal: options.signal } : {}),
			}),
		);
	}

	async addComponent(
		path: string,
		component: string,
		options: { save?: boolean; ensure?: boolean; signal?: AbortSignal | undefined } = {},
	): Promise<UnitySceneObjectResult> {
		return normalizeSceneObject(
			await this.requestJson<unknown>("/v1/component", {
				method: "POST",
				body: {
					path,
					component,
					...(options.save === true ? { save: true } : {}),
					...(options.ensure === true ? { ensure: true } : {}),
				},
				...(options.signal ? { signal: options.signal } : {}),
			}),
		);
	}

	async removeComponent(
		path: string,
		component: string,
		options: { index?: number; save?: boolean; signal?: AbortSignal | undefined } = {},
	): Promise<UnitySceneObjectResult> {
		return normalizeSceneObject(
			await this.requestJson<unknown>("/v1/component", {
				method: "DELETE",
				body: {
					path,
					component,
					...(options.index !== undefined ? { index: options.index } : {}),
					...(options.save === true ? { save: true } : {}),
				},
				...(options.signal ? { signal: options.signal } : {}),
			}),
		);
	}

	async setProperty(
		input: {
			path: string;
			component: string;
			property: string;
			value: unknown;
			index?: number;
			save?: boolean;
		},
		signal?: AbortSignal,
	): Promise<UnityPropertyChange> {
		return normalizePropertyChange(
			await this.requestJson<unknown>("/v1/property", {
				method: "PATCH",
				body: {
					path: input.path,
					component: input.component,
					property: input.property,
					value: input.value,
					...(input.index !== undefined ? { index: input.index } : {}),
					...(input.save === true ? { save: true } : {}),
				},
				...(signal ? { signal } : {}),
			}),
		);
	}

	async saveScene(
		options: { path?: string; signal?: AbortSignal | undefined } = {},
	): Promise<{ ok: boolean; path: string }> {
		return this.requestJson("/v1/scene/save", {
			method: "POST",
			body: options.path ? { path: options.path } : {},
			...(options.signal ? { signal: options.signal } : {}),
		});
	}

	async undo(steps = 1, signal?: AbortSignal): Promise<UnityUndoResult> {
		return this.requestJson("/v1/undo", {
			method: "POST",
			body: { steps },
			...(signal ? { signal } : {}),
		});
	}

	async executeMenu(item: string, signal?: AbortSignal): Promise<UnityMenuResult> {
		return this.requestJson("/v1/menu", {
			method: "POST",
			body: { item },
			...(signal ? { signal } : {}),
		});
	}

	async profilerSnapshot(signal?: AbortSignal): Promise<UnityProfilerSnapshot> {
		return normalizeProfilerSnapshot(
			await this.requestJson<unknown>("/v1/profiler", { ...(signal ? { signal } : {}) }),
		);
	}

	async queueInput(
		keys: readonly string[],
		options: { releaseAll?: boolean; signal?: AbortSignal | undefined } = {},
	): Promise<UnityInputResult> {
		return this.requestJson("/v1/input", {
			method: "POST",
			body: {
				keys,
				...(options.releaseAll === true ? { releaseAll: true } : {}),
			},
			...(options.signal ? { signal: options.signal } : {}),
		});
	}

	async quitEditor(
		options: { save?: boolean; discard?: boolean; signal?: AbortSignal | undefined } = {},
	): Promise<UnityQuitResult> {
		return this.requestJson("/v1/editor/quit", {
			method: "POST",
			body: {
				...(options.save === true ? { save: true } : {}),
				...(options.discard === true ? { discard: true } : {}),
			},
			...(options.signal ? { signal: options.signal } : {}),
		});
	}

	async startBuild(
		options: {
			target?: UnityBuildTarget;
			outputPath?: string;
			scenes?: string[];
			development?: boolean;
			signal?: AbortSignal | undefined;
		} = {},
	): Promise<UnityBuildRecord> {
		return normalizeBuildRecord(
			await this.requestJson<unknown>("/v1/build", {
				method: "POST",
				body: {
					...(options.target ? { target: options.target } : {}),
					...(options.outputPath ? { outputPath: options.outputPath } : {}),
					...(options.scenes ? { scenes: options.scenes } : {}),
					...(options.development === true ? { development: true } : {}),
				},
				...(options.signal ? { signal: options.signal } : {}),
			}),
		);
	}

	async waitForBuild(
		buildId: string,
		options: { timeoutMs?: number; signal?: AbortSignal | undefined } = {},
	): Promise<UnityBuildRecord> {
		const timeoutMs = options.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS;
		return this.poll(
			async () =>
				normalizeBuildRecord(
					await this.requestJson<unknown>(`/v1/build/status?id=${encodeURIComponent(buildId)}`, {
						...(options.signal ? { signal: options.signal } : {}),
					}),
				),
			(build) => build.state !== "running",
			Date.now() + timeoutMs,
			`Unity did not finish building within ${Math.round(timeoutMs / 1000)}s.`,
			options.signal,
		);
	}

	async listPackages(signal?: AbortSignal): Promise<UnityPackageList> {
		const deadline = Date.now() + 60_000;
		for (;;) {
			const page = normalizePackageList(
				await this.requestJson<unknown>("/v1/packages", { ...(signal ? { signal } : {}) }),
			);
			if (!page.pending) {
				if (page.error && page.packages.length === 0) {
					throw new UnityBridgeError("BRIDGE_HTTP", page.error);
				}
				return page;
			}
			if (Date.now() > deadline) {
				throw new UnityBridgeError("BRIDGE_TIMEOUT", "Unity did not list packages in time.");
			}
			await sleep(POLL_INTERVAL_MS, signal);
		}
	}

	async changePackage(
		action: "add" | "remove",
		id: string,
		signal?: AbortSignal,
	): Promise<UnityPackageChange> {
		return this.requestJson("/v1/packages", {
			method: "POST",
			body: { action, id },
			...(signal ? { signal } : {}),
		});
	}

	async readSettings(signal?: AbortSignal): Promise<UnityPlayerSettings> {
		return normalizePlayerSettings(
			await this.requestJson<unknown>("/v1/settings", { ...(signal ? { signal } : {}) }),
		);
	}

	async writeSettings(
		settings: Partial<UnityPlayerSettingsValues> & { platform?: string },
		signal?: AbortSignal,
	): Promise<UnityPlayerSettings> {
		return normalizePlayerSettings(
			await this.requestJson<unknown>("/v1/settings", {
				method: "POST",
				body: { settings },
				...(signal ? { signal } : {}),
			}),
		);
	}

	/** Project-registered [BridgeTool] methods the Editor exposes through `unity_tool`. */
	async listEditorTools(signal?: AbortSignal): Promise<UnityEditorTool[]> {
		return normalizeEditorTools(
			await this.requestJson<unknown>("/v1/tools", { ...(signal ? { signal } : {}) }),
		);
	}

	async invokeEditorTool(
		name: string,
		parameters: Record<string, unknown> = {},
		signal?: AbortSignal,
	): Promise<UnityEditorToolResult> {
		const raw = objectValue(
			await this.requestJson<unknown>("/v1/tools", {
				method: "POST",
				body: { name, parameters },
				...(signal ? { signal } : {}),
			}),
		);
		return { ok: raw.ok === true, name: stringValue(raw.name) || name, result: raw.result };
	}

	private async poll<T>(
		read: () => Promise<T | undefined>,
		done: (value: T) => boolean,
		deadline: number,
		timeoutMessage: string,
		signal?: AbortSignal,
	): Promise<T> {
		let lastError: unknown;
		let consecutiveBridgeFailures = 0;
		while (Date.now() < deadline) {
			await sleep(POLL_INTERVAL_MS, signal);
			try {
				const value = await read();
				if (value !== undefined && done(value)) return value;
				lastError = undefined;
				consecutiveBridgeFailures = 0;
			} catch (error) {
				if (signal?.aborted === true) throw error;
				lastError = error;
				if (!isPollReconnectable(error)) {
					if (
						error instanceof UnityBridgeError &&
						(error.code === "BRIDGE_PROTOCOL_MISMATCH" || error.code === "BRIDGE_PROJECT_MISMATCH")
					) {
						throw error;
					}
					continue;
				}
				if (this.refreshDiscoveryIfChanged()) {
					consecutiveBridgeFailures = 0;
					continue;
				}
				consecutiveBridgeFailures += 1;
				if (consecutiveBridgeFailures >= 3) throw error;
			}
		}
		throw new UnityBridgeError(
			"BRIDGE_TIMEOUT",
			`${timeoutMessage}${lastError instanceof Error ? ` Last error: ${lastError.message}` : ""}`,
		);
	}

	/**
	 * Unity restarts its bridge across a domain reload with a new port and token. Re-reading the
	 * discovery file in place keeps a compile/test poll alive instead of timing out against a dead port.
	 */
	private refreshDiscoveryIfChanged(): boolean {
		const next = readUnityBridgeDiscovery(this.discovery.projectPath, this.homeDir);
		if (!next) return false;
		const current = this.discovery;
		if (next.port === current.port && next.token === current.token && next.pid === current.pid) {
			return false;
		}
		if (!isBridgeProtocolSupported(next)) throw protocolMismatchError(next);
		this.discovery = next;
		this.baseUrl = `http://127.0.0.1:${next.port}`;
		return true;
	}

	private async requestJson<T>(
		path: string,
		options: {
			method?: "GET" | "POST" | "PATCH" | "DELETE";
			body?: unknown;
			signal?: AbortSignal | undefined;
		} = {},
	): Promise<T> {
		const response = await this.fetch(path, options);
		if (!response.ok) throw await this.httpError(response);
		try {
			return (await response.json()) as T;
		} catch (error) {
			throw new UnityBridgeError("BRIDGE_HTTP", "Unity returned invalid JSON.", {
				status: response.status,
				cause: error,
			});
		}
	}

	private async fetch(
		path: string,
		options: {
			method?: "GET" | "POST" | "PATCH" | "DELETE";
			body?: unknown;
			signal?: AbortSignal | undefined;
		} = {},
	): Promise<Response> {
		const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
		const signal =
			options.signal === undefined
				? timeoutSignal
				: AbortSignal.any([options.signal, timeoutSignal]);
		try {
			return await fetch(`${this.baseUrl}${path}`, {
				method: options.method ?? "GET",
				headers: {
					Authorization: `Bearer ${this.discovery.token}`,
					Accept: "application/json",
					...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
				},
				...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
				signal,
			});
		} catch (error) {
			if (options.signal?.aborted === true) throw error;
			if (timeoutSignal.aborted) {
				throw new UnityBridgeError(
					"BRIDGE_TIMEOUT",
					`The Unity bridge did not answer ${path} within ${Math.round(this.requestTimeoutMs / 1000)}s.`,
					{ cause: error },
				);
			}
			throw new UnityBridgeError(
				"BRIDGE_UNAVAILABLE",
				`Could not reach the Unity bridge on port ${this.discovery.port}. The Editor may be reloading.`,
				{ cause: error },
			);
		}
	}

	private async httpError(response: Response): Promise<UnityBridgeError> {
		const detail = await safeText(response);
		if (response.status === 401 || response.status === 403) {
			return new UnityBridgeError(
				"BRIDGE_AUTH",
				"The Unity bridge rejected this host's token. Restart the bridge in Unity.",
				{ status: response.status, detail },
			);
		}
		// The bridge answers failures with `{ error: { code, message } }`; its message is the only place
		// the real cause is written (a scene with unsaved changes, a compile already running, a run in
		// progress), so it is the user-facing text instead of a bare status code.
		const reported = bridgeErrorMessage(detail);
		return new UnityBridgeError(
			"BRIDGE_HTTP",
			reported ?? `Unity bridge request failed (${response.status}).`,
			{ status: response.status, detail },
		);
	}
}

function bridgeErrorMessage(detail: string): string | null {
	if (detail.length === 0) return null;
	try {
		const parsed = JSON.parse(detail) as { error?: { message?: unknown } };
		const message = parsed.error?.message;
		return typeof message === "string" && message.trim().length > 0 ? message.trim() : null;
	} catch {
		return null;
	}
}

function protocolMismatchError(discovery: UnityBridgeDiscovery): UnityBridgeError {
	return new UnityBridgeError(
		"BRIDGE_PROTOCOL_MISMATCH",
		`The Unity bridge speaks protocol ${discovery.protocolVersion}; this host speaks ${UNITY_BRIDGE_PROTOCOL_VERSION}. Update com.thinkrail.bridge.`,
	);
}

function isPollReconnectable(error: unknown): boolean {
	return (
		error instanceof UnityBridgeError &&
		(error.code === "BRIDGE_AUTH" || error.code === "BRIDGE_UNAVAILABLE")
	);
}

function objectValue(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const COMPILE_STATES: readonly UnityCompileState[] = ["idle", "compiling", "succeeded", "failed"];
const LOG_LEVELS: readonly UnityLogLevel[] = ["error", "warning", "log", "exception", "assert"];
const TEST_STATES: readonly UnityTestRunState[] = ["running", "passed", "failed", "error"];
const TEST_RESULT_STATUSES: readonly UnityTestResult["status"][] = [
	"passed",
	"failed",
	"skipped",
	"inconclusive",
];

function normalizeCompileStatus(value: unknown): UnityCompileStatus {
	const raw = objectValue(value);
	const finishedAt = optionalString(raw.finishedAt);
	const durationMs = optionalNumber(raw.durationMs);
	const state = COMPILE_STATES.includes(raw.state as UnityCompileState)
		? (raw.state as UnityCompileState)
		: "idle";
	const diagnostics = Array.isArray(raw.diagnostics)
		? raw.diagnostics.map(normalizeDiagnostic)
		: [];
	return {
		id: numberValue(raw.id),
		state,
		startedAt: stringValue(raw.startedAt),
		...(finishedAt === undefined ? {} : { finishedAt }),
		...(durationMs === undefined ? {} : { durationMs }),
		diagnostics,
	};
}

function normalizeDiagnostic(value: unknown): UnityDiagnostic {
	const raw = objectValue(value);
	return {
		severity: raw.severity === "error" ? "error" : "warning",
		message: stringValue(raw.message),
		...(optionalString(raw.file) === undefined ? {} : { file: stringValue(raw.file) }),
		...(optionalNumber(raw.line) === undefined ? {} : { line: numberValue(raw.line) }),
		...(optionalNumber(raw.column) === undefined ? {} : { column: numberValue(raw.column) }),
		...(optionalString(raw.assembly) === undefined ? {} : { assembly: stringValue(raw.assembly) }),
	};
}

function normalizeBridgeStatus(value: unknown): UnityBridgeStatus {
	const raw = objectValue(value);
	const protocolVersion = numberValue(raw.protocolVersion);
	if (protocolVersion !== UNITY_BRIDGE_PROTOCOL_VERSION) {
		throw protocolMismatchError({ protocolVersion } as UnityBridgeDiscovery);
	}
	const selection = Array.isArray(raw.selection) ? raw.selection.map(normalizeSelection) : [];
	const activeScene =
		typeof raw.activeScene === "string" && raw.activeScene.length > 0 ? raw.activeScene : null;
	return {
		protocolVersion,
		port: numberValue(raw.port),
		projectPath: stringValue(raw.projectPath),
		unityVersion: stringValue(raw.unityVersion),
		bridgeStartedAt: stringValue(raw.bridgeStartedAt),
		isPlaying: raw.isPlaying === true,
		isPaused: raw.isPaused === true,
		isCompiling: raw.isCompiling === true,
		isUpdating: raw.isUpdating === true,
		applicationPath: stringValue(raw.applicationPath),
		platform: stringValue(raw.platform),
		activeScene,
		selection,
		lastCompile: raw.lastCompile == null ? null : normalizeCompileStatus(raw.lastCompile),
		consoleSeq: numberValue(raw.consoleSeq),
	};
}

function normalizeSelection(value: unknown): UnitySelectionEntry {
	const raw = objectValue(value);
	return {
		name: stringValue(raw.name),
		path: stringValue(raw.path),
		type: stringValue(raw.type),
		instanceId: numberValue(raw.instanceId),
	};
}

function normalizeConsolePage(value: unknown): UnityConsolePage {
	const raw = objectValue(value);
	return {
		entries: Array.isArray(raw.entries) ? raw.entries.map(normalizeConsoleEntry) : [],
		nextSeq: numberValue(raw.nextSeq),
		dropped: numberValue(raw.dropped),
	};
}

function normalizeConsoleEntry(value: unknown): UnityConsoleEntry {
	const raw = objectValue(value);
	const stackTrace = optionalString(raw.stackTrace);
	return {
		seq: numberValue(raw.seq),
		time: stringValue(raw.time),
		level: LOG_LEVELS.includes(raw.level as UnityLogLevel) ? (raw.level as UnityLogLevel) : "log",
		message: stringValue(raw.message),
		...(stackTrace === undefined ? {} : { stackTrace }),
	};
}

function normalizeHierarchySnapshot(value: unknown): UnityHierarchySnapshot {
	const raw = objectValue(value);
	return {
		scene: stringValue(raw.scene),
		scenePath: stringValue(raw.scenePath),
		roots: Array.isArray(raw.roots) ? raw.roots.map(normalizeHierarchyNode) : [],
		truncated: raw.truncated === true,
	};
}

function normalizeHierarchyNode(value: unknown): UnityHierarchyNode {
	const raw = objectValue(value);
	return {
		name: stringValue(raw.name),
		path: stringValue(raw.path),
		scene: stringValue(raw.scene),
		activeSelf: raw.activeSelf === true,
		activeInHierarchy: raw.activeInHierarchy === true,
		instanceId: numberValue(raw.instanceId),
		components: Array.isArray(raw.components)
			? raw.components.map((component) => {
					const entry = objectValue(component);
					return {
						type: stringValue(entry.type),
						enabled: entry.enabled === true,
						instanceId: numberValue(entry.instanceId),
					};
				})
			: [],
		children: Array.isArray(raw.children) ? raw.children.map(normalizeHierarchyNode) : [],
	};
}

function normalizeTestRunStatus(value: unknown): UnityTestRunStatus {
	const raw = objectValue(value);
	const finishedAt = optionalString(raw.finishedAt);
	const durationMs = optionalNumber(raw.durationMs);
	const error = optionalString(raw.error);
	return {
		runId: stringValue(raw.runId),
		mode: raw.mode === "play" ? "play" : "edit",
		state: TEST_STATES.includes(raw.state as UnityTestRunState)
			? (raw.state as UnityTestRunState)
			: "error",
		startedAt: stringValue(raw.startedAt),
		...(finishedAt === undefined ? {} : { finishedAt }),
		...(durationMs === undefined ? {} : { durationMs }),
		passed: numberValue(raw.passed),
		failed: numberValue(raw.failed),
		skipped: numberValue(raw.skipped),
		results: Array.isArray(raw.results) ? raw.results.map(normalizeTestResult) : [],
		...(error === undefined ? {} : { error }),
	};
}

function normalizeTestResult(value: unknown): UnityTestResult {
	const raw = objectValue(value);
	const message = optionalString(raw.message);
	const stackTrace = optionalString(raw.stackTrace);
	const status = TEST_RESULT_STATUSES.includes(raw.status as UnityTestResult["status"])
		? (raw.status as UnityTestResult["status"])
		: "inconclusive";
	return {
		name: stringValue(raw.name),
		fullName: stringValue(raw.fullName),
		status,
		durationMs: numberValue(raw.durationMs),
		...(message === undefined ? {} : { message }),
		...(stackTrace === undefined ? {} : { stackTrace }),
	};
}

async function safeText(response: Response): Promise<string> {
	try {
		return (await response.text()).slice(0, 2_000);
	} catch {
		return "";
	}
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted === true) throw signal.reason;
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
	if (bytes.byteLength < 24) return { width: 0, height: 0 };
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];
	for (let index = 0; index < signature.length; index += 1) {
		if (bytes[index] !== signature[index]) return { width: 0, height: 0 };
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}
