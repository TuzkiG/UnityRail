import type { ResourceRenderer } from "../../registry";

export const unityAssetRenderer: ResourceRenderer = {
	id: "thinkrail/unity-asset",
	labelKey: "viewer.renderer.unity",
	match: { glob: ["*.unity", "*.prefab", "*.asset"], text: true },
	rank: 140,
	capabilities: {
		view: false,
		diff: true,
		anchors: { view: [], diff: ["line"] },
		mobile: true,
		copy: false,
		layout: false,
		whitespace: false,
	},
	loadDiff: () => import("./UnityAssetDiff"),
};
