import type { UnitySelectionEntry } from "@thinkrail/contracts";

/** The path `unity.inspect` can read for the Editor's selection: the first scene GameObject. */
export function editorSelectionPath(
	selection: readonly UnitySelectionEntry[] | null | undefined,
): string | null {
	return (
		selection?.find((entry) => entry.type === "GameObject" && entry.path.length > 0)?.path ?? null
	);
}
