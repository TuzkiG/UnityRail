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
	type UnityCompileState,
	type UnityCompileStatus,
	type UnityConsoleEntry,
	type UnityConsolePage,
	type UnityDiagnostic,
	type UnityGameObjectInspection,
	type UnityHierarchyNode,
	type UnityHierarchySnapshot,
	type UnityLogLevel,
	type UnityPlayModeAction,
	type UnitySelectionEntry,
	type UnityTestResult,
	type UnityTestRunState,
	type UnityTestRunStatus,
} from "./protocol.ts";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_COMPILE_TIMEOUT_MS = 240_000;
const DEFAULT_TEST_TIMEOUT_MS = 600_000;
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
			method?: "GET" | "POST" | "DELETE";
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
			method?: "GET" | "POST" | "DELETE";
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
