import type { UnityObjectModel, UnitySemanticObject } from "./model";

export type UnityAssetKind = "scene" | "prefab" | "asset";

export interface UnityAssetObjectRef {
	fileId: string;
	classId: number;
	type: string;
	name: string;
	path: string;
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
	truncated: boolean;
}

const MAX_ADDED = 200;
const MAX_CHANGED = 400;
const MAX_FIELDS_PER_OBJECT = 60;

export function unityAssetKind(path: string): UnityAssetKind | null {
	const lower = path.toLowerCase();
	if (lower.endsWith(".unity")) return "scene";
	if (lower.endsWith(".prefab")) return "prefab";
	if (lower.endsWith(".asset")) return "asset";
	return null;
}

function refOf(object: UnitySemanticObject): UnityAssetObjectRef {
	return {
		fileId: object.fileId,
		classId: object.classId,
		type: object.type,
		name: object.name,
		path: object.path,
		line: object.line,
	};
}

function byLocation(left: UnityAssetObjectRef, right: UnityAssetObjectRef): number {
	return (
		left.path.localeCompare(right.path) ||
		left.name.localeCompare(right.name) ||
		left.type.localeCompare(right.type) ||
		left.fileId.localeCompare(right.fileId)
	);
}

function fieldChanges(
	before: ReadonlyArray<{ path: string; value: string }>,
	after: ReadonlyArray<{ path: string; value: string }>,
): UnityAssetFieldChange[] {
	const beforeMap = new Map(before.map((entry) => [entry.path, entry.value]));
	const afterMap = new Map(after.map((entry) => [entry.path, entry.value]));
	const paths = new Set([...beforeMap.keys(), ...afterMap.keys()]);
	const changes: UnityAssetFieldChange[] = [];
	for (const path of paths) {
		const left = beforeMap.get(path);
		const right = afterMap.get(path);
		if (left === right) continue;
		changes.push({ field: path, before: left ?? "", after: right ?? "" });
		if (changes.length >= MAX_FIELDS_PER_OBJECT) break;
	}
	return changes.sort((a, b) => a.field.localeCompare(b.field));
}

/**
 * Object-level change set between two versions of a Unity asset. Objects are matched by fileID, the
 * identity Unity itself keeps across a save, so added/removed is real and a changed object keeps its
 * name/path even when every line moved.
 */
export function diffUnityObjectModels(
	kind: UnityAssetKind,
	original: UnityObjectModel,
	modified: UnityObjectModel,
): UnityAssetDiff {
	const before = new Map(original.objects.map((object) => [object.fileId, object]));
	const after = new Map(modified.objects.map((object) => [object.fileId, object]));
	const added: UnityAssetObjectRef[] = [];
	const removed: UnityAssetObjectRef[] = [];
	const changed: UnityAssetObjectChange[] = [];
	let truncated = original.truncated || modified.truncated;
	for (const [fileId, object] of after) {
		if (before.has(fileId)) continue;
		if (added.length >= MAX_ADDED) {
			truncated = true;
			break;
		}
		added.push(refOf(object));
	}
	for (const [fileId, object] of before) {
		if (after.has(fileId)) continue;
		if (removed.length >= MAX_ADDED) {
			truncated = true;
			break;
		}
		removed.push(refOf(object));
	}
	for (const [fileId, object] of after) {
		const previous = before.get(fileId);
		if (!previous) continue;
		const fields = fieldChanges(previous.fields, object.fields);
		if (fields.length === 0) continue;
		if (changed.length >= MAX_CHANGED) {
			truncated = true;
			break;
		}
		changed.push({ object: refOf(object), fields });
	}
	return {
		kind,
		added: added.sort(byLocation),
		removed: removed.sort(byLocation),
		changed: changed.sort((a, b) => byLocation(a.object, b.object)),
		truncated,
	};
}

export function isEmptyUnityAssetDiff(diff: UnityAssetDiff): boolean {
	return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}
