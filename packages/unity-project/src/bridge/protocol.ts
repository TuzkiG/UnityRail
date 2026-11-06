/**
 * The wire between the UnityRail host and the Unity Editor package.
 *
 * The Unity side implements this shape with Newtonsoft.Json; the TypeScript side treats every field as
 * untrusted input and normalizes it. Bump `UNITY_BRIDGE_PROTOCOL_VERSION` for any shape change that an
 * older Editor package cannot answer.
 */
export const UNITY_BRIDGE_PROTOCOL_VERSION = 2;

export const UNITY_BRIDGE_DISCOVERY_FILE = "ThinkRailBridge.json";
export const UNITY_BRIDGE_REGISTRY_FILE = "bridges.json";

export type UnityLogLevel = "error" | "warning" | "log" | "exception" | "assert";

export interface UnityConsoleEntry {
	seq: number;
	time: string;
	level: UnityLogLevel;
	message: string;
	stackTrace?: string;
}

export interface UnityDiagnostic {
	severity: "error" | "warning";
	message: string;
	file?: string;
	line?: number;
	column?: number;
	assembly?: string;
}

export type UnityCompileState = "idle" | "compiling" | "succeeded" | "failed";

export interface UnityCompileStatus {
	id: number;
	state: UnityCompileState;
	startedAt: string;
	finishedAt?: string;
	durationMs?: number;
	diagnostics: UnityDiagnostic[];
}

export interface UnitySelectionEntry {
	name: string;
	path: string;
	type: string;
	instanceId: number;
}

export type UnityPlayModeAction = "play" | "stop" | "pause" | "resume" | "step";

export interface UnityBridgeStatus {
	protocolVersion: number;
	port: number;
	projectPath: string;
	unityVersion: string;
	bridgeStartedAt: string;
	isPlaying: boolean;
	isPaused: boolean;
	isCompiling: boolean;
	isUpdating: boolean;
	applicationPath: string;
	platform: string;
	activeScene: string | null;
	selection: UnitySelectionEntry[];
	lastCompile: UnityCompileStatus | null;
	consoleSeq: number;
}

export interface UnityBridgeDiscovery {
	protocolVersion: number;
	port: number;
	token: string;
	pid: number;
	projectPath: string;
	unityVersion: string;
	startedAt: string;
}

export interface UnityConsolePage {
	entries: UnityConsoleEntry[];
	nextSeq: number;
	dropped: number;
}

export interface UnityTestResult {
	name: string;
	fullName: string;
	status: "passed" | "failed" | "skipped" | "inconclusive";
	durationMs: number;
	message?: string;
	stackTrace?: string;
}

export type UnityTestRunState = "running" | "passed" | "failed" | "error";

export interface UnityTestRunStatus {
	runId: string;
	mode: "edit" | "play";
	state: UnityTestRunState;
	startedAt: string;
	finishedAt?: string;
	durationMs?: number;
	passed: number;
	failed: number;
	skipped: number;
	results: UnityTestResult[];
	error?: string;
}

export interface UnityComponentSummary {
	type: string;
	enabled: boolean;
	instanceId: number;
}

export interface UnityHierarchyNode {
	name: string;
	path: string;
	scene: string;
	activeSelf: boolean;
	activeInHierarchy: boolean;
	instanceId: number;
	components: UnityComponentSummary[];
	children: UnityHierarchyNode[];
}

export interface UnityHierarchySnapshot {
	scene: string;
	scenePath: string;
	roots: UnityHierarchyNode[];
	truncated: boolean;
}

export interface UnityPropertyValue {
	name: string;
	type: string;
	value: string;
}

export interface UnityComponentInspection {
	type: string;
	enabled: boolean;
	instanceId: number;
	properties: UnityPropertyValue[];
}

export interface UnityGameObjectInspection {
	name: string;
	path: string;
	scene: string;
	tag: string;
	layer: number;
	isStatic: boolean;
	activeSelf: boolean;
	instanceId: number;
	components: UnityComponentInspection[];
}

export interface UnityAssetResult {
	name: string;
	path: string;
	guid: string;
	type: string;
}

export interface UnityDoctorFinding {
	severity: "error" | "warning" | "info";
	code: string;
	message: string;
	path?: string;
}

export interface UnityDoctorReport {
	root: string;
	editorVersion: string;
	productName: string | null;
	unityInstalled: boolean;
	editorPath: string | null;
	bridgeConnected: boolean;
	bridgeMatchesWorkspace: boolean;
	findings: UnityDoctorFinding[];
}

export type UnityBuildTarget =
	| "windows"
	| "windows32"
	| "macos"
	| "linux"
	| "android"
	| "ios"
	| "webgl";

export type UnityBuildState = "running" | "succeeded" | "failed";

export interface UnityBuildRecord {
	buildId: string;
	state: UnityBuildState;
	target: string;
	outputPath: string;
	startedAt: string;
	finishedAt?: string;
	durationMs?: number;
	totalSize?: number;
	result?: string;
	errors: string[];
	error?: string;
}

export interface UnitySceneObjectResult {
	ok: boolean;
	path: string;
	instanceId?: number;
	components?: string[];
	saved?: boolean;
}

export interface UnityPropertyChange {
	ok: boolean;
	path: string;
	component: string;
	property: string;
	before: string;
	after: string;
	saved?: boolean;
}

export interface UnityPackageInfo {
	name: string;
	displayName?: string;
	version: string;
	source: string;
	direct?: boolean;
}

export interface UnityPackageList {
	packages: UnityPackageInfo[];
}

export interface UnityPackageChange {
	ok: boolean;
	accepted?: boolean;
	id: string;
	action: "add" | "remove";
	package?: { name: string; version: string; source: string } | null;
}

export interface UnityPlayerSettingsValues {
	productName: string;
	companyName: string;
	bundleVersion: string;
	applicationIdentifier: string;
	runInBackground: boolean;
	defaultScreenWidth: number;
	defaultScreenHeight: number;
	fullscreenMode: string;
	resizableWindow: boolean;
}

export interface UnityPlayerSettings {
	platform: string;
	values: UnityPlayerSettingsValues;
	allowed?: string[];
}

export interface UnityProfilerMarker {
	name: string;
	category: string;
	unit: string;
	value: number;
}

export interface UnityProfilerSnapshot {
	frame: number;
	isPlaying: boolean;
	markers: UnityProfilerMarker[];
}

export interface UnityInputResult {
	ok: boolean;
	keys: string[];
	isPlaying: boolean;
}

export interface UnityMenuResult {
	ok: boolean;
	item: string;
}

export interface UnityUndoResult {
	ok: boolean;
	steps: number;
}

export interface UnityQuitResult {
	ok: boolean;
	quitting: boolean;
	saved: boolean;
}
