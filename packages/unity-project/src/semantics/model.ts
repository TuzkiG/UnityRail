import { parseUnityYaml, unityClassType } from "./yaml";

export interface UnitySemanticObject {
	fileId: string;
	classId: number;
	/** Display type: a class name, or the resolved script's name for a MonoBehaviour. */
	type: string;
	rawType: string;
	/** Owning GameObject's name (a component's own `m_Name` is empty). */
	name: string;
	/** Transform path, e.g. `Player/Weapon`; empty when the object has no GameObject. */
	path: string;
	/** 1-based line of the object's document in the source text. */
	line: number;
	fields: Array<{ path: string; value: string }>;
}

export interface UnityObjectModel {
	objects: UnitySemanticObject[];
	truncated: boolean;
}

export interface UnityObjectModelOptions {
	/** Resolves an asset GUID to a project-relative path (the GUID index). */
	resolveGuid?: (guid: string) => string | null;
}

const GAMEOBJECT = 1;
const TRANSFORM_CLASSES = new Set([4, 224]);
const MONOBEHAVIOUR = 114;
const MAX_PATH_DEPTH = 32;
const MAX_FIELDS_PER_OBJECT = 600;

function isTransform(classId: number): boolean {
	return TRANSFORM_CLASSES.has(classId);
}

function scriptAsset(guid: string, options: UnityObjectModelOptions): string | null {
	if (guid === "") return null;
	return options.resolveGuid?.(guid) ?? null;
}

function assetLabel(guid: string, fileId: string, options: UnityObjectModelOptions): string {
	const path = scriptAsset(guid, options);
	const ref = `fileID ${fileId}`;
	if (path !== null) return `${path} (${ref})`;
	return `guid ${guid.slice(0, 8)}… (${ref})`;
}

function fileBaseName(path: string): string {
	const normalized = path.replaceAll("\\", "/");
	const name = normalized.slice(normalized.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Builds the object graph Unity's YAML describes: GameObject names, transform paths, MonoBehaviour
 * scripts (through the GUID index) and resolved references. Identity is the fileID, so a diff can
 * follow an object across an edit even when its line moves.
 */
export function buildUnityObjectModel(
	source: string,
	options: UnityObjectModelOptions = {},
): UnityObjectModel {
	const parsed = parseUnityYaml(source);
	const gameObjects = new Map<string, string>();
	const transformOfGameObject = new Map<string, string>();
	const transformFather = new Map<string, string>();
	const transformGameObject = new Map<string, string>();
	const scriptOf = new Map<string, string>();
	const fieldsByFileId = new Map<string, Map<string, string>>();

	function field(documentIndex: number, path: string): string {
		const document = parsed.documents[documentIndex];
		if (!document) return "";
		const match = document.fields.find((entry) => entry.path === path);
		return match?.value ?? "";
	}

	parsed.documents.forEach((document, index) => {
		const name = field(index, "m_Name");
		if (document.classId === GAMEOBJECT) gameObjects.set(document.fileId, name);
		if (isTransform(document.classId)) {
			const owner = field(index, "m_GameObject");
			const father = field(index, "m_Father");
			if (owner !== "") {
				transformGameObject.set(document.fileId, owner);
				if (!transformOfGameObject.has(owner)) transformOfGameObject.set(owner, document.fileId);
			}
			transformFather.set(document.fileId, father);
		}
		if (document.classId === MONOBEHAVIOUR) {
			const pair = document.fields.find((entry) => entry.path === "m_Script");
			if (pair?.kind === "assetRef") {
				const [guid = ""] = pair.value.split(":");
				const asset = scriptAsset(guid, options);
				if (asset !== null) scriptOf.set(document.fileId, asset);
			}
		}
	});

	const byFileId = new Map(parsed.documents.map((document) => [document.fileId, document]));
	const objectNameCache = new Map<string, string>();

	function gameObjectName(fileId: string): string {
		return gameObjects.get(fileId) ?? "";
	}

	function objectName(fileId: string): string {
		const cached = objectNameCache.get(fileId);
		if (cached !== undefined) return cached;
		const document = byFileId.get(fileId);
		if (!document) {
			objectNameCache.set(fileId, "");
			return "";
		}
		let name = "";
		if (document.classId === GAMEOBJECT) name = gameObjects.get(fileId) ?? "";
		if (name === "") {
			const owner = document.fields.find((entry) => entry.path === "m_GameObject")?.value ?? "";
			if (owner !== "" && owner !== "0") name = gameObjectName(owner);
		}
		if (name === "") {
			const script = scriptOf.get(fileId);
			if (script !== undefined) name = fileBaseName(script);
		}
		if (name === "") name = document.fields.find((entry) => entry.path === "m_Name")?.value ?? "";
		if (name === "") name = unityClassType(document.classId);
		objectNameCache.set(fileId, name);
		return name;
	}

	function transformPath(transformId: string): string {
		const names: string[] = [];
		const seen = new Set<string>();
		let current = transformId;
		for (let depth = 0; depth < MAX_PATH_DEPTH && current !== "" && current !== "0"; depth += 1) {
			if (seen.has(current)) break;
			seen.add(current);
			const owner = transformGameObject.get(current) ?? "";
			const name = gameObjectName(owner);
			if (name !== "") names.push(name);
			current = transformFather.get(current) ?? "";
		}
		return names.reverse().join("/");
	}

	function objectPath(fileId: string): string {
		const document = byFileId.get(fileId);
		if (!document) return "";
		if (isTransform(document.classId)) return transformPath(fileId);
		const owner = document.fields.find((entry) => entry.path === "m_GameObject")?.value ?? "";
		const own = owner !== "" && owner !== "0" ? transformOfGameObject.get(owner) : undefined;
		if (own !== undefined) return transformPath(own);
		const direct = transformOfGameObject.get(fileId);
		return direct !== undefined ? transformPath(direct) : "";
	}

	const objects: UnitySemanticObject[] = [];
	let truncated = parsed.truncated;
	for (const document of parsed.documents) {
		const displayType = (() => {
			const script = scriptOf.get(document.fileId);
			if (document.classId === MONOBEHAVIOUR && script !== undefined) return fileBaseName(script);
			return unityClassType(document.classId);
		})();
		const resolved = new Map<string, string>();
		for (const entry of document.fields) {
			if (resolved.size >= MAX_FIELDS_PER_OBJECT) {
				truncated = true;
				break;
			}
			if (entry.kind === "fileRef") {
				// Raw fileIDs on purpose: resolving them to names would make a rename ripple into every
				// component's `m_GameObject` and every parent's `m_Children`. The row header already shows
				// the object's name and transform path.
				resolved.set(entry.path, `fileID ${entry.value}`);
				continue;
			}
			if (entry.kind === "assetRef") {
				const [guid = "", fileId = ""] = entry.value.split(":");
				resolved.set(entry.path, assetLabel(guid, fileId, options));
				continue;
			}
			resolved.set(entry.path, entry.value);
		}
		fieldsByFileId.set(document.fileId, resolved);
		objects.push({
			fileId: document.fileId,
			classId: document.classId,
			type: displayType,
			rawType: document.rawType,
			name: objectName(document.fileId),
			path: objectPath(document.fileId),
			line: document.line,
			fields: [...resolved].map(([path, value]) => ({ path, value })),
		});
	}
	return { objects, truncated };
}
