import { isMap, isScalar, isSeq, LineCounter, parseAllDocuments } from "yaml";

/** Unity writes one YAML document per object: `--- !u!<classId> &<fileId>`. */
export interface UnityYamlDocument {
	classId: number;
	fileId: string;
	rawType: string;
	line: number;
	fields: UnityYamlField[];
}

export interface UnityYamlField {
	path: string;
	value: string;
	line: number;
	kind: "scalar" | "fileRef" | "assetRef";
}

export interface UnityYamlText {
	documents: UnityYamlDocument[];
	truncated: boolean;
}

const MAX_DOCUMENTS = 4_000;
const MAX_FIELDS_PER_DOCUMENT = 2_000;
const MAX_VALUE_LENGTH = 160;
const MAX_DEPTH = 12;

const CLASS_NAMES: Record<number, string> = {
	1: "GameObject",
	4: "Transform",
	20: "Camera",
	21: "Material",
	23: "MeshRenderer",
	25: "Renderer",
	28: "Texture2D",
	33: "MeshFilter",
	43: "Mesh",
	54: "Rigidbody",
	64: "MeshCollider",
	65: "BoxCollider",
	82: "AudioSource",
	83: "AudioClip",
	95: "Animator",
	104: "RenderSettings",
	108: "Light",
	111: "Animation",
	114: "MonoBehaviour",
	115: "MonoScript",
	128: "Font",
	135: "SphereCollider",
	136: "CapsuleCollider",
	143: "CharacterController",
	157: "LightmapSettings",
	196: "NavMeshAgent",
	198: "ParticleSystem",
	199: "ParticleSystemRenderer",
	212: "SpriteRenderer",
	213: "Sprite",
	222: "CanvasRenderer",
	223: "Canvas",
	224: "RectTransform",
	225: "CanvasGroup",
	228: "CanvasRenderer",
	240: "AudioMixer",
	1001: "PrefabInstance",
};

export function unityClassType(classId: number): string {
	return CLASS_NAMES[classId] ?? `Class ${classId}`;
}

function text(value: unknown): string {
	const rendered = value === null || value === undefined ? "" : String(value);
	return rendered.length > MAX_VALUE_LENGTH ? `${rendered.slice(0, MAX_VALUE_LENGTH)}…` : rendered;
}

function refValue(node: {
	items?: unknown;
}): { kind: "fileRef" | "assetRef"; value: string } | null {
	if (!isMap(node)) return null;
	let fileId = "";
	let guid = "";
	for (const pair of node.items) {
		const key = isScalar(pair.key) ? String(pair.key.value) : "";
		if (key === "fileID" && isScalar(pair.value)) fileId = String(pair.value.value);
		if (key === "guid" && isScalar(pair.value)) guid = String(pair.value.value);
	}
	if (fileId === "" && guid === "") return null;
	if (guid !== "") return { kind: "assetRef", value: `${guid}:${fileId}` };
	return { kind: "fileRef", value: fileId };
}

function flatten(
	node: unknown,
	path: string,
	line: number,
	depth: number,
	out: UnityYamlField[],
	lineCounter: LineCounter,
): void {
	if (out.length >= MAX_FIELDS_PER_DOCUMENT || depth > MAX_DEPTH) return;
	if (node === null || node === undefined) return;
	const nodeLine = (() => {
		const range = (node as { range?: [number, number, number] }).range;
		return range ? lineCounter.linePos(range[0]).line : line;
	})();
	if (isScalar(node)) {
		out.push({ path, value: text(node.value), line: nodeLine, kind: "scalar" });
		return;
	}
	const ref = refValue(node as { items?: unknown });
	if (ref) {
		out.push({ path, value: ref.value, line: nodeLine, kind: ref.kind });
		return;
	}
	if (isSeq(node)) {
		node.items.forEach((item, index) => {
			flatten(
				item,
				path === "" ? String(index) : `${path}[${index}]`,
				nodeLine,
				depth + 1,
				out,
				lineCounter,
			);
		});
		return;
	}
	if (isMap(node)) {
		for (const pair of node.items) {
			const key = isScalar(pair.key) ? String(pair.key.value) : "";
			if (key === "") continue;
			flatten(
				pair.value,
				path === "" ? key : `${path}.${key}`,
				nodeLine,
				depth + 1,
				out,
				lineCounter,
			);
		}
	}
}

/**
 * Unity's asset YAML is multi-document, tag-anchored and full of `{fileID, guid}` references. This
 * reads it without validating the schema: an unknown class still yields its fields, so a diff never
 * goes blind on a component Unity added in a newer version.
 */
export function parseUnityYaml(source: string): UnityYamlText {
	const lineCounter = new LineCounter();
	const documents = parseAllDocuments(source, {
		lineCounter,
		prettyErrors: false,
		strict: false,
		uniqueKeys: false,
		// Unity declares YAML 1.1, where `y`/`n`/`on` are booleans; a field named `m_LocalPosition.y`
		// must stay a string key. `failsafe` keeps every scalar a string: a 64-bit fileID must never pass
		// through a JS number (180532686481926429 becomes ...430), or references stop matching.
		version: "1.2",
		schema: "failsafe",
		customTags: (tags) => tags,
	});
	const parsed: UnityYamlDocument[] = [];
	let truncated = false;
	for (const document of documents) {
		if (parsed.length >= MAX_DOCUMENTS) {
			truncated = true;
			break;
		}
		const root = document.contents;
		if (!isMap(root) || root.items.length === 0) continue;
		const anchor = typeof root.anchor === "string" ? root.anchor : "";
		const tag = typeof root.tag === "string" ? root.tag : "";
		const classMatch = /unity3d\.com,\d+:(\d+)$/.exec(tag) ?? /^!u!(\d+)$/.exec(tag);
		if (anchor === "" || classMatch?.[1] === undefined) continue;
		const first = root.items[0];
		const rawType = isScalar(first?.key) ? String(first.key.value) : "";
		const fields: UnityYamlField[] = [];
		const rootLine = root.range ? lineCounter.linePos(root.range[0]).line : 1;
		flatten(first?.value, "", rootLine, 0, fields, lineCounter);
		parsed.push({
			classId: Number(classMatch[1]),
			fileId: anchor,
			rawType,
			line: rootLine,
			fields,
		});
	}
	return { documents: parsed, truncated };
}
