import { version } from "@thinkrail/shared/version";
import type { ElectrobunConfig } from "electrobun";

// Hutch reads `build.bun.version` like the other toolchain versions, but ElectrobunConfig does not type
// it, so the literal is kept out of the excess-property check. It must match the root packageManager pin.
const bun = { entrypoint: "src/index.ts", version: "1.4.4" };
const MICROPHONE_USAGE = "ThinkRail uses the microphone only while you dictate with voice input.";

export default {
	app: {
		name: "UnityRail",
		identifier: "ai.unityrail.app",
		version,
	},
	runtime: {
		exitOnLastWindowClosed: true,
	},
	// This fork publishes no update feed of its own. An empty base URL keeps the native updater disabled
	// (`nativeUpdatesEnabled` refuses it), so the app never advertises upstream UnityRail releases it
	// cannot install.
	release: {
		baseUrl: "",
		generatePatch: false,
	},
	build: {
		mainProcess: "bun",
		bun,
		views: { preload: { entrypoint: "src/preload.ts", format: "iife" } },
		copy: {
			"../web/dist": "views/web",
			".stage/runtime": "runtime",
		},
		mac: {
			bundleCEF: false,
			icons: "../../packages/shared/assets/icon.iconset",
			entitlements: { "com.apple.security.device.audio-input": MICROPHONE_USAGE },
		},
		linux: { bundleCEF: false, icon: "../../packages/shared/assets/icon.png" },
		win: {
			bundleCEF: false,
			icon: "../../packages/shared/assets/icon.ico",
			autoGrantPermissions: ["microphone"],
		},
	},
	scripts: { preBuild: "preBuild.ts", postBuild: "postBuild.ts" },
} satisfies ElectrobunConfig;
