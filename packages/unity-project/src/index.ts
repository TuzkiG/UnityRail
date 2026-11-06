export type {
	UnityBridgeConnection,
	UnityBridgeConnectionOptions,
	UnityBridgeErrorCode,
	UnityCompileOptions,
	UnityConsoleOptions,
	UnityScreenshot,
	UnityScreenshotView,
	UnityTestOptions,
} from "./bridge/client.ts";
export {
	connectUnityBridge,
	pngDimensions,
	sleep,
	UnityBridgeClient,
	UnityBridgeError,
	withUnityBridge,
} from "./bridge/client.ts";
export type { UnityBridgeRegistryEntry } from "./bridge/discovery.ts";
export {
	bridgeDiscoveryPath,
	bridgeProjectMatches,
	bridgeRegistryPath,
	isBridgeProtocolSupported,
	isProcessAlive,
	parseBridgeDiscovery,
	readBridgeRegistry,
	readProjectBridgeDiscovery,
	readUnityBridgeDiscovery,
} from "./bridge/discovery.ts";
export {
	EMBEDDED_BRIDGE_PACKAGE_NAME,
	EMBEDDED_BRIDGE_PACKAGE_VERSION,
} from "./bridge/embeddedPackage.ts";
export type { InstallBridgeResult } from "./bridge/install.ts";
export {
	BRIDGE_PACKAGE_FOLDER,
	bridgePackagePath,
	installBridgePackage,
	installedBridgePackageVersion,
	isBridgePackageInstalled,
} from "./bridge/install.ts";
export type {
	UnityAssetResult,
	UnityBridgeDiscovery,
	UnityBridgeStatus,
	UnityBuildRecord,
	UnityBuildState,
	UnityBuildTarget,
	UnityCompileState,
	UnityCompileStatus,
	UnityComponentInspection,
	UnityComponentSummary,
	UnityConsoleEntry,
	UnityConsolePage,
	UnityDiagnostic,
	UnityDoctorFinding,
	UnityDoctorReport,
	UnityEditorTool,
	UnityEditorToolList,
	UnityEditorToolResult,
	UnityGameObjectInspection,
	UnityHierarchyNode,
	UnityHierarchySnapshot,
	UnityInputResult,
	UnityLogLevel,
	UnityMenuResult,
	UnityPackageChange,
	UnityPackageInfo,
	UnityPackageList,
	UnityPlayerSettings,
	UnityPlayerSettingsValues,
	UnityPlayModeAction,
	UnityProfilerMarker,
	UnityProfilerSnapshot,
	UnityPropertyChange,
	UnityPropertyValue,
	UnityQuitResult,
	UnitySceneObjectResult,
	UnitySelectionEntry,
	UnityTestResult,
	UnityTestRunState,
	UnityTestRunStatus,
	UnityUndoResult,
} from "./bridge/protocol.ts";
export {
	UNITY_BRIDGE_DISCOVERY_FILE,
	UNITY_BRIDGE_PROTOCOL_VERSION,
	UNITY_BRIDGE_REGISTRY_FILE,
} from "./bridge/protocol.ts";
export type { UnityDoctorOptions, UnityDoctorResult } from "./doctor.ts";
export { diagnoseUnityWorkspace } from "./doctor.ts";
export type { OpenUnityProjectOptions, OpenUnityProjectResult } from "./launch.ts";
export { openUnityProject } from "./launch.ts";
export {
	buildAssemblyGraph,
	parseAssemblyDefinition,
	readAssemblyDefinitions,
} from "./project/asmdef.ts";
export {
	createDirectoryLink,
	linkExists,
	listDirectoryLinks,
	moduleMountPath,
	removeDirectoryLink,
} from "./project/links.ts";
export {
	buildGuidIndex,
	clearUnityProjectCaches,
	parseMetaGuid,
	readAssetGuid,
	resolveGuid,
} from "./project/meta.ts";
export type { UnityDetectedModule, UnityModuleKind } from "./project/modules.ts";
export {
	detectUnityModules,
	nestedAssetRepositories,
	parseGitmodules,
} from "./project/modules.ts";
export {
	assertUnityProject,
	canonicalProjectPath,
	findUnityProjectRoot,
	isUnityProjectRoot,
	readJsonFile,
	readTextFile,
	sameProjectPath,
	stripBom,
	UNITY_PROJECT_MARKER,
	walkUnityContent,
	walkUnityContentBounded,
} from "./project/paths.ts";
export {
	findUnityInstall,
	readUnityProject,
} from "./project/project.ts";
export type { UnityVersionInfo } from "./project/settings.ts";
export {
	parsePackages,
	parseProjectSettings,
	parseProjectVersion,
	readPackages,
	readProjectSettings,
	readProjectVersion,
} from "./project/settings.ts";
export type {
	UnityAssemblyDefinition,
	UnityAssemblyGraph,
	UnityAssemblyNode,
	UnityAssetSummary,
	UnityGuidIndex,
	UnityPackage,
	UnityProjectCounts,
	UnityProjectInfo,
} from "./project/types.ts";
export { UnityProjectError } from "./project/types.ts";
export type {
	UnityAssetDiff,
	UnityAssetFieldChange,
	UnityAssetKind,
	UnityAssetObjectChange,
	UnityAssetObjectRef,
	UnityObjectModel,
	UnityObjectModelOptions,
	UnitySemanticObject,
	UnityYamlDocument,
	UnityYamlField,
	UnityYamlText,
} from "./semantics/index.ts";
export {
	buildUnityObjectModel,
	diffUnityObjectModels,
	isEmptyUnityAssetDiff,
	parseUnityYaml,
	unityAssetKind,
	unityClassType,
} from "./semantics/index.ts";
