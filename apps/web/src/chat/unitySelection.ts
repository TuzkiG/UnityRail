import type { UnityStatusSnapshot } from "@thinkrail/contracts";

export interface UnityEditorSelection {
	name: string;
	path: string;
	type: string;
	scene: string | null;
}

/** The Editor's selection as the composer shows it: the first entry that has a path to report. */
export function unitySelectionOf(status: UnityStatusSnapshot): UnityEditorSelection | null {
	const bridge = status.bridge;
	const entry = bridge?.selection.find((candidate) => candidate.path.length > 0);
	if (!entry) return null;
	return {
		name: entry.name,
		path: entry.path,
		type: entry.type,
		scene: entry.type === "GameObject" ? (bridge?.activeScene ?? null) : null,
	};
}

export function sameUnitySelection(
	current: UnityEditorSelection | null,
	next: UnityEditorSelection | null,
): boolean {
	if (current === null || next === null) return current === next;
	return (
		current.name === next.name &&
		current.path === next.path &&
		current.type === next.type &&
		current.scene === next.scene
	);
}
