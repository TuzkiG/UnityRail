import type { UnityAssetDiff } from "@thinkrail/contracts";
import {
	buildGuidIndex,
	buildUnityObjectModel,
	diffUnityObjectModels,
	unityAssetKind,
} from "@thinkrail/unity-project";
import { unityProjectRoot } from "./service.ts";

const MAX_ASSET_TEXT_BYTES = 8 * 1024 * 1024;

/**
 * Object-level diff of a Unity asset. `null` means "not a Unity asset / not inside a Unity project /
 * too large to be useful here" — the caller keeps the raw text diff in that case.
 */
export function unityAssetDiff(
	workspaceId: string,
	path: string,
	original: string,
	modified: string,
): UnityAssetDiff | null {
	const kind = unityAssetKind(path);
	if (!kind) return null;
	if (original.length > MAX_ASSET_TEXT_BYTES || modified.length > MAX_ASSET_TEXT_BYTES) return null;
	const root = unityProjectRoot(workspaceId);
	if (!root) return null;
	const index = buildGuidIndex(root);
	const options = { resolveGuid: (guid: string) => index.byGuid.get(guid) ?? null };
	return diffUnityObjectModels(
		kind,
		buildUnityObjectModel(original, options),
		buildUnityObjectModel(modified, options),
	);
}
