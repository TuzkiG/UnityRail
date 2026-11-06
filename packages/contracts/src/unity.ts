/**
 * Browser-safe Unity wire types.
 *
 * The Unity Editor bridge's own protocol lives in `@thinkrail/unity-project`; these are the shapes the
 * host exposes to the UI. They are deliberately structural copies: the host maps bridge responses into
 * them, and the web app never imports a Node-only package.
 */

export type UnityLogLevel = "error" | "warning" | "log" | "exception" | "assert";

export interface UnityConsoleEntry {
	seq: number;
	time: string;
	level: UnityLogLevel;
	message: string;
	stackTrace?: string;
}

export interface UnityConsolePage {
	entries: UnityConsoleEntry[];
	nextSeq: number;
	dropped: number;
}

export type UnityCompileState = "idle" | "compiling" | "succeeded" | "failed";

export interface UnityDiagnostic {
	severity: "error" | "warning";
	message: string;
	file?: string;
	line?: number;
	column?: number;
	assembly?: string;
}

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

export interface UnityScreenshotPayload {
	view: "game" | "scene";
	mimeType: "image/png";
	base64: string;
	width: number;
	height: number;
	bytes: number;
}

export interface UnityPackageSummary {
	name: string;
	version: string;
	builtin: boolean;
}

export interface UnityAssemblySummary {
	name: string;
	path: string;
	editorOnly: boolean;
	references: string[];
	missingReferences: string[];
}

export interface UnityProjectSummary {
	root: string;
	editorVersion: string;
	productName: string | null;
	companyName: string | null;
	counts: {
		assets: number;
		scripts: number;
		scenes: number;
		prefabs: number;
		assemblies: number;
	};
	packages: UnityPackageSummary[];
	assemblies: UnityAssemblySummary[];
	scenes: Array<{ name: string; path: string }>;
	prefabs: Array<{ name: string; path: string }>;
	warnings: string[];
}

export interface UnityBridgeErrorSummary {
	code: string;
	message: string;
}

export interface UnityWorkspaceSnapshot {
	workspaceId: string;
	isUnityProject: boolean;
	projectRoot: string | null;
	/** Whether the ThinkRail/UnityRail bridge package is embedded under `Packages/com.thinkrail.bridge`. */
	bridgeInstalled: boolean;
	/** Installed package version, or null when it is not installed. */
	bridgePackageVersion: string | null;
	/** The bundled package is newer than the copy in the project. */
	bridgePackageStale: boolean;
	project: UnityProjectSummary | null;
	projectError: UnityBridgeErrorSummary | null;
	bridge: UnityBridgeStatus | null;
	bridgeError: UnityBridgeErrorSummary | null;
}

/** The ambient read live surfaces poll: no project model, and never a thrown Unity failure. */
export interface UnityStatusSnapshot {
	/** False outside a Unity project, so a poller can stop until it remounts. */
	isUnityProject: boolean;
	/** The live Editor status, or null when no bridge answered this read. */
	bridge: UnityBridgeStatus | null;
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

export interface UnityVerifyDetails {
	compile: UnityCompileStatus;
	tests: UnityTestRunStatus | null;
	console: UnityConsolePage | null;
	screenshot: Omit<UnityScreenshotPayload, "base64"> | null;
}

export type UnityModuleKind = "submodule" | "repo" | "external";

/** How a module is attached to the Unity project. */
export type UnityLinkType = "junction" | "symlink" | "submodule" | "repo";

export interface UnityProjectModule {
	name: string;
	/** Absolute path of the module's source folder. */
	path: string;
	kind: UnityModuleKind;
	gitUrl?: string;
	/** Absolute path inside the project the module is attached at, once linked. */
	mountPath?: string;
	linkType?: UnityLinkType;
}

/** An external connection the project currently makes, read from the project itself. */
export interface UnityExternalLink {
	name: string;
	/** Absolute path of the entry inside the project (`Assets/...`). */
	path: string;
	/** Absolute path of the external folder a directory link points at. */
	target: string;
	type: UnityLinkType;
}

export interface UnityFolderEntry {
	name: string;
	/** Absolute path of the folder. */
	path: string;
}

export interface UnityProjectConfig {
	workspaceId: string;
	/** The configured Unity project root, or null when it has not been chosen yet. */
	projectRoot: string | null;
	/** The business-layer root whose child folders are listed for linking. */
	businessPath: string | null;
	/** The external directory configured to be linked into the project. */
	linkTarget: string | null;
	/** Child folders read from `businessPath`. */
	businessFolders: UnityFolderEntry[];
	/** Modules the user linked to this project. */
	modules: UnityProjectModule[];
	/** Modules the project itself declares (`.gitmodules`, nested checkouts), offered for linking. */
	detected: UnityProjectModule[];
	/** External connections the project already uses. */
	externalLinks: UnityExternalLink[];
	/** The project root the workspace resolves to without configuration, if any. */
	detectedProjectRoot: string | null;
}

export interface UnityBridgeInstallResult {
	installed: boolean;
	alreadyInstalled: boolean;
	updated: boolean;
	path: string;
	packageName: string;
	packageVersion: string;
	files: number;
}

export interface UnityOpenEditorResult {
	started: boolean;
	editorPath: string;
	pid: number | null;
}

export type UnityAssetKind = "scene" | "prefab" | "asset";

export interface UnityAssetObjectRef {
	fileId: string;
	classId: number;
	/** Display type: a class name, or the script's name for a MonoBehaviour. */
	type: string;
	name: string;
	/** Transform path, e.g. `Player/Weapon`; empty when the object has no GameObject. */
	path: string;
	/** 1-based line of the object's YAML document (modified side; base side for a removed object). */
	line: number;
}

export interface UnityAssetFieldChange {
	field: string;
	before: string;
	after: string;
}

export interface UnityAssetObjectChange {
	object: UnityAssetObjectRef;
	fields: UnityAssetFieldChange[];
}

export interface UnityAssetDiff {
	kind: UnityAssetKind;
	added: UnityAssetObjectRef[];
	removed: UnityAssetObjectRef[];
	changed: UnityAssetObjectChange[];
	/** A cap was hit (objects, fields or documents); the view says so rather than lying. */
	truncated: boolean;
}

export type UnityGuardCode =
	| "MISSING_META"
	| "ORPHAN_META"
	| "DUPLICATE_GUID"
	| "LARGE_ASSET"
	| "MERGE_DRIVER_MISSING"
	| "IGNORE_MISSING";

export interface UnityGuardFinding {
	code: UnityGuardCode;
	severity: "error" | "warning";
	/** Workspace-relative path the finding is about; absent for a project-wide finding. */
	path?: string;
	/** Extra identifiers, e.g. the GUID an asset conflicts on. */
	detail?: string;
}

export interface UnityGuardReport {
	findings: UnityGuardFinding[];
	checkedAt: number;
	/** The changed paths the guard inspected, so the UI can say "nothing found" honestly. */
	checkedPaths: number;
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
	/** A list request is still running; ask again. */
	pending?: boolean;
	error?: string;
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
