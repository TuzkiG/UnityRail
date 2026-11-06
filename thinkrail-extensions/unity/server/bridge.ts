import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	sleep,
	type UnityBridgeStatus,
	type UnityBuildRecord,
	type UnityBuildTarget,
	type UnityCompileStatus,
	type UnityConsolePage,
	type UnityLogLevel,
	type UnityPackageChange,
	type UnityPackageList,
	type UnityPlayerSettings,
	type UnityPlayerSettingsValues,
	type UnityPlayModeAction,
	type UnityProfilerSnapshot,
	type UnityScreenshot,
	type UnityTestRunStatus,
	withUnityBridge,
} from "@thinkrail/unity-project";
import { Type } from "typebox";
import { errorMessage, errorResult, formatBytes, textResult, unityProjectRoot } from "./shared.ts";

const LOG_LEVELS: UnityLogLevel[] = ["log", "warning", "error", "exception", "assert"];
const PLAY_ACTIONS: UnityPlayModeAction[] = ["play", "stop", "pause", "resume", "step"];

const compileParams = Type.Object({
	force: Type.Optional(
		Type.Boolean({
			description: "Request a compile even if Unity does not think scripts changed.",
		}),
	),
});

const consoleParams = Type.Object({
	since: Type.Optional(
		Type.Number({
			description:
				"Only return entries with a sequence greater than this. Use the nextSeq from a previous result.",
		}),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum entries (default 100, max 1000)." })),
	levels: Type.Optional(
		Type.Array(Type.Unsafe<UnityLogLevel>({ type: "string", enum: LOG_LEVELS }), {
			description: "Filter by log level.",
		}),
	),
	clear: Type.Optional(Type.Boolean({ description: "Clear the Unity Console before reading." })),
});

const playmodeParams = Type.Object({
	action: Type.Unsafe<UnityPlayModeAction>({
		type: "string",
		enum: PLAY_ACTIONS,
		description: "Play Mode transition: play, stop, pause, resume, or step one frame while paused.",
	}),
});

const screenshotParams = Type.Object({
	view: Type.Optional(
		Type.Unsafe<"game" | "scene">({
			type: "string",
			enum: ["game", "scene"],
			description:
				"Capture the Game View (play mode or main camera) or the Scene View (default game).",
		}),
	),
	width: Type.Optional(
		Type.Number({ description: "Target width in pixels (default 1280, max 1600)." }),
	),
});

const SCENE_ACTIONS = [
	"create",
	"delete",
	"addComponent",
	"removeComponent",
	"setProperty",
	"save",
	"undo",
] as const;

const PROJECT_ACTIONS = [
	"menu",
	"build",
	"buildStatus",
	"packages",
	"addPackage",
	"removePackage",
	"settings",
	"writeSettings",
	"profiler",
	"input",
	"quit",
] as const;

const editSceneParams = Type.Object({
	action: Type.Unsafe<(typeof SCENE_ACTIONS)[number]>({
		type: "string",
		enum: [...SCENE_ACTIONS],
		description:
			"create | delete | addComponent | removeComponent | setProperty | save | undo. delete and removeComponent require confirm:true.",
	}),
	name: Type.Optional(Type.String({ description: "create: the new GameObject's name." })),
	parent: Type.Optional(
		Type.String({ description: "create: hierarchy path of the parent, e.g. `Canvas/Panel`." }),
	),
	components: Type.Optional(
		Type.Array(Type.String(), {
			description: 'create: component type names to add, e.g. ["SpriteRenderer","BoxCollider2D"].',
		}),
	),
	path: Type.Optional(
		Type.String({ description: "Hierarchy path of the target object, e.g. `Player/Weapon`." }),
	),
	component: Type.Optional(Type.String({ description: "Component type name, e.g. `Transform`." })),
	property: Type.Optional(
		Type.String({ description: "Serialized property path, e.g. `m_LocalPosition.x`." }),
	),
	value: Type.Optional(
		Type.Unsafe<unknown>({
			description:
				"setProperty: scalar, enum name/index, {x,y,z(,w)} for vectors, {r,g,b,a} for colors, or an Assets/ path / hierarchy path for an object reference.",
		}),
	),
	index: Type.Optional(
		Type.Number({ description: "Index when the object has several components of that type." }),
	),
	save: Type.Optional(
		Type.Boolean({
			description: "Save the scene (or prefab stage) after the change. Default false.",
		}),
	),
	steps: Type.Optional(
		Type.Number({ description: "undo: how many undo steps (1-10, default 1)." }),
	),
	confirm: Type.Optional(
		Type.Boolean({
			description: "Required for delete/removeComponent: set true only after the user approved.",
		}),
	),
});

const projectActionParams = Type.Object({
	action: Type.Unsafe<(typeof PROJECT_ACTIONS)[number]>({
		type: "string",
		enum: [...PROJECT_ACTIONS],
		description:
			"menu | build | buildStatus | packages | addPackage | removePackage | settings | writeSettings | profiler | input | quit. menu/build/addPackage/removePackage/writeSettings/quit require confirm:true.",
	}),
	item: Type.Optional(
		Type.String({ description: "menu: the exact menu item path, e.g. `Assets/Refresh`." }),
	),
	target: Type.Optional(
		Type.Unsafe<UnityBuildTarget>({
			type: "string",
			enum: ["windows", "windows32", "macos", "linux", "android", "ios", "webgl"],
			description: "build: target platform (default windows).",
		}),
	),
	outputPath: Type.Optional(
		Type.String({
			description: "build: output path inside the project folder (default Builds/<target>).",
		}),
	),
	scenes: Type.Optional(
		Type.Array(Type.String(), {
			description: "build: explicit project-relative scene list; omitted uses Build Settings.",
		}),
	),
	development: Type.Optional(Type.Boolean({ description: "build: produce a development build." })),
	id: Type.Optional(
		Type.String({ description: "packages/buildStatus: the package id or build id to act on." }),
	),
	settings: Type.Optional(
		Type.Unsafe<Record<string, unknown>>({
			type: "object",
			additionalProperties: true,
			description:
				"writeSettings: allowlisted PlayerSettings keys (productName, companyName, bundleVersion, applicationIdentifier, runInBackground, defaultScreenWidth, defaultScreenHeight, fullscreenMode, resizableWindow) and an optional platform.",
		}),
	),
	keys: Type.Optional(
		Type.Array(Type.String(), {
			description: 'input: keys to hold, e.g. ["Space","W"]; send [] to release.',
		}),
	),
	releaseAll: Type.Optional(Type.Boolean({ description: "input: release every held key." })),
	save: Type.Optional(Type.Boolean({ description: "quit: save open scenes before exiting." })),
	discard: Type.Optional(
		Type.Boolean({ description: "quit: discard unsaved scenes (requires save to be false)." }),
	),
	confirm: Type.Optional(
		Type.Boolean({
			description: "Required for menu/build/addPackage/removePackage/writeSettings/quit.",
		}),
	),
});

const testsParams = Type.Object({
	mode: Type.Optional(
		Type.Unsafe<"edit" | "play">({
			type: "string",
			enum: ["edit", "play"],
			description: "EditMode (default) or PlayMode tests.",
		}),
	),
	filter: Type.Optional(
		Type.String({ description: "Optional test name filter, e.g. a fixture or full test name." }),
	),
});

const verifyParams = Type.Object({
	play: Type.Optional(
		Type.Boolean({ description: "Enter Play Mode after compiling and capture a Game View frame." }),
	),
	playSeconds: Type.Optional(
		Type.Number({ description: "Seconds to play before capturing (default 5, max 30)." }),
	),
	screenshot: Type.Optional(
		Type.Boolean({ description: "Capture a Game View screenshot (default true)." }),
	),
	width: Type.Optional(Type.Number({ description: "Screenshot width (default 1280)." })),
	testMode: Type.Optional(
		Type.Unsafe<"edit" | "play">({
			type: "string",
			enum: ["edit", "play"],
			description: "Run EditMode or PlayMode tests before playing.",
		}),
	),
	filter: Type.Optional(Type.String({ description: "Optional test name filter." })),
});

function formatCompile(compile: UnityCompileStatus): string {
	const seconds = ((compile.durationMs ?? 0) / 1000).toFixed(2);
	const errors = compile.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
	const warnings = compile.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
	if (compile.state === "succeeded" && compile.diagnostics.length === 0) {
		return `Unity compiled successfully in ${seconds}s.`;
	}
	const lines = [
		compile.state === "succeeded"
			? `Unity compiled with ${warnings.length} warning${warnings.length === 1 ? "" : "s"} in ${seconds}s.`
			: `Unity compile failed with ${errors.length} error${errors.length === 1 ? "" : "s"} and ${warnings.length} warning${warnings.length === 1 ? "" : "s"} in ${seconds}s.`,
	];
	for (const diagnostic of compile.diagnostics.slice(0, 80)) {
		const location = diagnostic.file
			? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}${diagnostic.column ? `:${diagnostic.column}` : ""}`
			: (diagnostic.assembly ?? "compile");
		lines.push(`${location}: ${diagnostic.severity} ${diagnostic.message}`);
	}
	if (compile.diagnostics.length > 80) {
		lines.push(`… ${compile.diagnostics.length - 80} more diagnostics`);
	}
	return lines.join("\n");
}

function formatStatus(status: UnityBridgeStatus): string {
	const mode = status.isPlaying ? (status.isPaused ? "paused" : "playing") : "edit mode";
	const lines = [
		`Play Mode: ${mode}. Scene: ${status.activeScene ?? "(none)"}.`,
		status.isCompiling
			? "Unity is compiling."
			: status.lastCompile
				? `Last compile: ${status.lastCompile.state}.`
				: "No compile has run through the bridge yet.",
	];
	if (status.selection.length > 0) {
		lines.push(`Selection: ${status.selection.map((entry) => entry.name).join(", ")}`);
	}
	return lines.join(" ");
}

function formatConsole(page: UnityConsolePage): string {
	if (page.entries.length === 0) {
		return `No Unity Console entries since sequence ${page.nextSeq}.`;
	}
	const lines = [
		`Unity Console: ${page.entries.length} entr${page.entries.length === 1 ? "y" : "ies"} (next seq ${page.nextSeq}${page.dropped > 0 ? `, ${page.dropped} dropped` : ""}).`,
	];
	for (const entry of page.entries.slice(0, 120)) {
		const message =
			entry.message.length > 2000 ? `${entry.message.slice(0, 2000)}…` : entry.message;
		lines.push(`[${entry.level}] #${entry.seq} ${entry.time}: ${message}`);
		if ((entry.level === "error" || entry.level === "exception") && entry.stackTrace) {
			const stack = entry.stackTrace.split("\n").slice(0, 6).join("\n");
			lines.push(stack);
		}
	}
	if (page.entries.length > 120) lines.push(`… ${page.entries.length - 120} more entries`);
	return lines.join("\n");
}

function formatTests(run: UnityTestRunStatus): string {
	const seconds = ((run.durationMs ?? 0) / 1000).toFixed(2);
	const lines = [
		`Unity ${run.mode === "play" ? "PlayMode" : "EditMode"} tests: ${run.state} (${run.passed} passed, ${run.failed} failed, ${run.skipped} skipped) in ${seconds}s.`,
	];
	if (run.error) lines.push(run.error);
	for (const result of run.results.slice(0, 100)) {
		if (result.status === "passed") continue;
		lines.push(
			`[${result.status}] ${result.fullName || result.name}${result.message ? `: ${result.message.slice(0, 1500)}` : ""}`,
		);
		if (result.stackTrace) {
			lines.push(result.stackTrace.split("\n").slice(0, 8).join("\n"));
		}
	}
	if (run.failed === 0 && run.results.some((result) => result.status === "passed")) {
		lines.push("All executed tests passed.");
	}
	return lines.join("\n");
}

function formatProjectAction(action: string, result: unknown): string {
	if (action === "menu") {
		const menu = result as { item: string };
		return `Executed menu item ${menu.item}.`;
	}
	if (action === "build" || action === "buildStatus") {
		const build = result as UnityBuildRecord;
		const size = build.totalSize ? `, ${formatBytes(build.totalSize)}` : "";
		const duration = build.durationMs ? `, ${Math.round(build.durationMs / 1000)}s` : "";
		const errors = build.errors.length > 0 ? `\n${build.errors.slice(0, 5).join("\n")}` : "";
		const failure = build.error ? `\n${build.error}` : "";
		return `Build ${build.state}: ${build.target} → ${build.outputPath}${size}${duration}${failure}${errors}`;
	}
	if (action === "packages") {
		const list = result as UnityPackageList;
		const direct = list.packages.filter((entry) => entry.direct !== false);
		const names = direct
			.slice(0, 30)
			.map((entry) => `${entry.name}@${entry.version}`)
			.join(", ");
		return `${list.packages.length} packages (${direct.length} direct): ${names}`;
	}
	if (action === "addPackage" || action === "removePackage") {
		const change = result as UnityPackageChange;
		const outcome = change.package
			? `${change.package.name}@${change.package.version}`
			: "accepted; re-read packages after Unity reloads";
		return `${change.action} ${change.id}: ${outcome}`;
	}
	if (action === "settings" || action === "writeSettings") {
		const settings = result as UnityPlayerSettings;
		return Object.entries(settings.values)
			.map(([key, value]) => `${key}: ${String(value)}`)
			.join("\n");
	}
	if (action === "profiler") {
		const profiler = result as UnityProfilerSnapshot;
		if (profiler.markers.length === 0)
			return "No profiler markers are available in this Unity version.";
		return profiler.markers
			.map((marker) => `${marker.name} (${marker.category}): ${marker.value} ${marker.unit}`)
			.join("\n");
	}
	if (action === "input") {
		const input = result as { keys: string[] };
		return input.keys.length === 0 ? "Released all keys." : `Holding: ${input.keys.join(", ")}.`;
	}
	if (action === "quit") return "The Editor is quitting.";
	return "Done.";
}

export function registerUnityBridgeTools(pi: ExtensionAPI): void {
	pi.registerTool<typeof compileParams, UnityCompileStatus | { error: string }>({
		name: "unity_compile",
		label: "Unity Compile",
		description:
			"Ask Unity to recompile scripts and wait for the result. Returns compiler errors and warnings with file/line/column, including results that arrive after Unity's domain reload. Run this after changing C# before trusting Play Mode or tests.",
		promptSnippet:
			"unity_compile — recompile Unity scripts and return compiler diagnostics (waits through domain reload).",
		parameters: compileParams,
		async execute(_callId, params, signal, _onUpdate, ctx) {
			try {
				const root = unityProjectRoot(ctx.cwd);
				const compile = await withUnityBridge(
					root,
					(client) => client.compile({ ...(params.force === true ? { force: true } : {}), signal }),
					signal ? { signal } : {},
				);
				const text = formatCompile(compile);
				const result = textResult(text, compile);
				return compile.state === "failed" ? { ...result, isError: true } : result;
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});

	pi.registerTool<typeof consoleParams, UnityConsolePage | { error: string }>({
		name: "unity_console",
		label: "Unity Console",
		description:
			"Read the Unity Console. Entries are sequence-numbered: pass the previous nextSeq as `since` to read only new output. Filter by level, or clear the Console when starting a fresh verification run. Runtime exceptions and Debug.Log output from Play Mode appear here.",
		promptSnippet:
			"unity_console — read Unity Console entries since a sequence, filter by level, or clear the Console.",
		parameters: consoleParams,
		async execute(_callId, params, signal, _onUpdate, ctx) {
			try {
				const root = unityProjectRoot(ctx.cwd);
				if (params.clear === true) {
					const page = await withUnityBridge(
						root,
						async (client) => {
							await client.clearConsole(signal);
							return client.console({ limit: 1, signal });
						},
						signal ? { signal } : {},
					);
					return textResult(`Unity Console cleared (next sequence ${page.nextSeq}).`, page);
				}
				const page = await withUnityBridge(
					root,
					(client) =>
						client.console({
							...(params.since === undefined ? {} : { since: params.since }),
							...(params.limit === undefined ? {} : { limit: params.limit }),
							...(params.levels === undefined ? {} : { levels: params.levels }),
							signal,
						}),
					{ retryUnavailable: true, ...(signal ? { signal } : {}) },
				);
				return textResult(formatConsole(page), page);
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});

	pi.registerTool<typeof playmodeParams, UnityBridgeStatus | { error: string }>({
		name: "unity_playmode",
		label: "Unity Play Mode",
		description:
			"Drive Unity Play Mode: enter play, stop, pause, resume, or step one frame while paused. Entering or leaving Play Mode can reload the Unity domain; the bridge reconnects and the returned status reflects the new Editor session.",
		promptSnippet: "unity_playmode — enter, stop, pause, resume, or step Unity Play Mode.",
		parameters: playmodeParams,
		async execute(_callId, params, signal, _onUpdate, ctx) {
			try {
				const root = unityProjectRoot(ctx.cwd);
				const status = await withUnityBridge(
					root,
					(client) => client.playmode(params.action, signal),
					signal ? { signal } : {},
				);
				return textResult(formatStatus(status), status);
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});

	pi.registerTool<typeof screenshotParams, Omit<UnityScreenshot, "base64"> | { error: string }>({
		name: "unity_screenshot",
		label: "Unity Screenshot",
		description:
			"Capture the Unity Game View (or Scene View) as a PNG that you can see. In Play Mode this is the actual game frame; outside Play Mode it renders the main camera. Use it to verify visuals, layout, UI and runtime behavior instead of guessing from code.",
		promptSnippet: "unity_screenshot — capture the Game or Scene View as an image you can inspect.",
		parameters: screenshotParams,
		async execute(_callId, params, signal, _onUpdate, ctx) {
			try {
				const root = unityProjectRoot(ctx.cwd);
				const width = Math.min(Math.max(params.width ?? 1280, 64), 1600);
				const shot = await withUnityBridge(
					root,
					(client) => client.screenshot(params.view ?? "game", { width, signal }),
					{ retryUnavailable: true, ...(signal ? { signal } : {}) },
				);
				const caption = `Captured Unity ${shot.view === "scene" ? "Scene View" : "Game View"} (${shot.width}×${shot.height}, ${formatBytes(shot.bytes)}).`;
				return {
					content: [
						{ type: "text", text: caption },
						{ type: "image", data: shot.base64, mimeType: shot.mimeType },
					],
					details: {
						view: shot.view,
						mimeType: shot.mimeType,
						bytes: shot.bytes,
						width: shot.width,
						height: shot.height,
					},
				};
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});

	pi.registerTool<typeof testsParams, UnityTestRunStatus | { error: string }>({
		name: "unity_tests",
		label: "Unity Tests",
		description:
			"Run EditMode or PlayMode tests through the Unity Test Framework and return per-test results. PlayMode tests can reload the domain; if Unity reloads mid-run the bridge reports an interrupted run instead of a false pass.",
		promptSnippet: "unity_tests — run Unity EditMode or PlayMode tests and return results.",
		parameters: testsParams,
		async execute(_callId, params, signal, _onUpdate, ctx) {
			try {
				const root = unityProjectRoot(ctx.cwd);
				const run = await withUnityBridge(
					root,
					(client) =>
						client.runTests({
							mode: params.mode ?? "edit",
							...(params.filter ? { filter: params.filter } : {}),
							signal,
						}),
					signal ? { signal } : {},
				);
				const result = textResult(formatTests(run), run);
				return run.state === "error" ? { ...result, isError: true } : result;
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});

	type VerifyDetails = {
		compile: UnityCompileStatus;
		tests: UnityTestRunStatus | null;
		console: UnityConsolePage | null;
		screenshot: Omit<UnityScreenshot, "base64"> | null;
	};

	pi.registerTool<typeof verifyParams, VerifyDetails | { error: string }>({
		name: "unity_verify",
		label: "Verify in Unity",
		description:
			"The Unity feedback loop in one call: recompile, optionally run tests, enter Play Mode, wait, capture a Game View frame, read new Console output, and stop Play Mode. Use it after a Unity change instead of claiming success from code inspection alone.",
		promptSnippet:
			"unity_verify — compile, optionally test, play, screenshot, read the Console, and stop Play Mode in one verification run.",
		parameters: verifyParams,
		async execute(_callId, params, signal, _onUpdate, ctx) {
			const root = unityProjectRoot(ctx.cwd);
			const bridgeOptions = signal ? { signal } : {};
			const lines: string[] = [];
			let compile: UnityCompileStatus;
			try {
				compile = await withUnityBridge(
					root,
					(client) => client.compile({ signal }),
					bridgeOptions,
				);
				lines.push(formatCompile(compile));
			} catch (error) {
				return errorResult(errorMessage(error));
			}
			if (compile.state === "failed") {
				return {
					...textResult(lines.join("\n"), {
						compile,
						tests: null,
						console: null,
						screenshot: null,
					}),
					isError: true,
				};
			}

			let tests: UnityTestRunStatus | null = null;
			if (params.testMode) {
				try {
					tests = await withUnityBridge(
						root,
						(client) =>
							client.runTests({
								mode: params.testMode === "play" ? "play" : "edit",
								...(params.filter ? { filter: params.filter } : {}),
								signal,
							}),
						bridgeOptions,
					);
					lines.push(formatTests(tests));
				} catch (error) {
					lines.push(`Tests could not run: ${errorMessage(error)}`);
				}
			}

			let consolePage: UnityConsolePage | null = null;
			let shot: UnityScreenshot | null = null;
			let playError: string | null = null;
			const shouldPlay = params.play !== false;
			if (shouldPlay) {
				let playStarted = false;
				try {
					const before = await withUnityBridge(
						root,
						(client) => client.console({ limit: 1, signal }),
						{ retryUnavailable: true, ...bridgeOptions },
					);
					await withUnityBridge(root, (client) => client.playmode("play", signal), bridgeOptions);
					playStarted = true;
					const seconds = Math.min(Math.max(params.playSeconds ?? 5, 1), 30);
					await sleep(seconds * 1000, signal);
					consolePage = await withUnityBridge(
						root,
						(client) => client.console({ since: before.nextSeq, limit: 200, signal }),
						{ retryUnavailable: true, ...bridgeOptions },
					);
					lines.push(formatConsole(consolePage));
					if (params.screenshot !== false) {
						try {
							shot = await withUnityBridge(
								root,
								(client) =>
									client.screenshot("game", {
										width: Math.min(Math.max(params.width ?? 1280, 64), 1600),
										signal,
									}),
								{ retryUnavailable: true, ...bridgeOptions },
							);
							lines.push(
								`Captured Game View after ${seconds}s (${shot.width}×${shot.height}, ${formatBytes(shot.bytes)}).`,
							);
						} catch (error) {
							lines.push(`Screenshot failed: ${errorMessage(error)}`);
						}
					}
				} catch (error) {
					playError = errorMessage(error);
					lines.push(`Play Mode verification failed: ${playError}`);
				} finally {
					if (playStarted) {
						try {
							await withUnityBridge(
								root,
								(client) => client.playmode("stop", signal),
								bridgeOptions,
							);
						} catch (error) {
							lines.push(`Could not stop Play Mode: ${errorMessage(error)}`);
						}
					}
				}
			}

			const details = {
				compile,
				tests,
				console: consolePage,
				screenshot: shot
					? {
							view: shot.view,
							mimeType: shot.mimeType,
							bytes: shot.bytes,
							width: shot.width,
							height: shot.height,
						}
					: null,
			};
			const content: Array<
				{ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" }
			> = [{ type: "text", text: lines.join("\n") }];
			if (shot) content.push({ type: "image", data: shot.base64, mimeType: shot.mimeType });
			if (playError) return { content, details, isError: true };
			return { content, details };
		},
	});

	pi.registerTool<typeof editSceneParams, Record<string, unknown>>({
		name: "unity_edit_scene",
		label: "Unity Edit Scene",
		description:
			"Edit the open Unity scene or prefab stage through the Editor's own APIs: create/delete a GameObject, add/remove a component, set a serialized property, save, or undo. Every change goes through Undo; saving is explicit (save:true). delete and removeComponent require confirm:true — ask the user first. After a change run unity_compile / unity_verify to prove it works.",
		promptSnippet:
			"unity_edit_scene — create/delete objects, add/remove components, set serialized properties, save or undo in the open Unity scene or prefab stage.",
		parameters: editSceneParams,
		async execute(_callId, params, signal, _onUpdate, ctx) {
			const action = params.action;
			if ((action === "delete" || action === "removeComponent") && params.confirm !== true) {
				return errorResult(
					`${action} changes the scene destructively. Ask the user first, then call again with confirm:true.`,
				);
			}
			try {
				const root = unityProjectRoot(ctx.cwd);
				const bridgeOptions = signal ? { signal } : {};
				const result = await withUnityBridge(
					root,
					async (client) => {
						switch (action) {
							case "create":
								return client.createObject(
									{
										name: params.name ?? "",
										...(params.parent ? { parent: params.parent } : {}),
										...(params.components ? { components: params.components } : {}),
										...(params.save === true ? { save: true } : {}),
									},
									signal,
								);
							case "delete":
								return client.deleteObject(params.path ?? "", {
									...(params.save === true ? { save: true } : {}),
									...(signal ? { signal } : {}),
								});
							case "addComponent":
								return client.addComponent(params.path ?? "", params.component ?? "", {
									...(params.save === true ? { save: true } : {}),
									...(signal ? { signal } : {}),
								});
							case "removeComponent":
								return client.removeComponent(params.path ?? "", params.component ?? "", {
									...(params.index === undefined ? {} : { index: params.index }),
									...(params.save === true ? { save: true } : {}),
									...(signal ? { signal } : {}),
								});
							case "setProperty":
								return client.setProperty(
									{
										path: params.path ?? "",
										component: params.component ?? "",
										property: params.property ?? "",
										value: params.value,
										...(params.index === undefined ? {} : { index: params.index }),
										...(params.save === true ? { save: true } : {}),
									},
									signal,
								);
							case "save":
								return client.saveScene({
									...(params.path ? { path: params.path } : {}),
									...(signal ? { signal } : {}),
								});
							case "undo":
								return client.undo(params.steps ?? 1, signal);
						}
					},
					bridgeOptions,
				);
				const text = (() => {
					if (action === "setProperty") {
						const change = result as unknown as {
							path: string;
							component: string;
							property: string;
							before: string;
							after: string;
						};
						return `${change.path} ${change.component}.${change.property}: ${change.before} → ${change.after}`;
					}
					if (action === "undo") {
						const undo = result as { steps: number };
						return `Undid ${undo.steps} step${undo.steps === 1 ? "" : "s"}.`;
					}
					if (action === "save") {
						const saved = result as { path: string };
						return `Saved ${saved.path}.`;
					}
					const scene = result as { path: string; components?: string[] };
					return `${action} ${scene.path}${scene.components && scene.components.length > 0 ? ` (+${scene.components.join(", ")})` : ""}${params.save === true ? " — saved" : ""}`;
				})();
				return textResult(text, result as unknown as Record<string, unknown>);
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});

	pi.registerTool<typeof projectActionParams, Record<string, unknown>>({
		name: "unity_project_action",
		label: "Unity Project Action",
		description:
			"Drive the Unity project outside the scene: run an Editor menu item, start a build and poll it, list/add/remove packages, read or write allowlisted PlayerSettings, take a profiler snapshot, synthesize keyboard input while in Play Mode, or quit the Editor. menu, build, package changes, settings writes and quit require confirm:true — ask the user first. Package changes and builds can reload the domain; the bridge may disconnect and reconnect.",
		promptSnippet:
			"unity_project_action — menu/build/packages/PlayerSettings/profiler/input/quit for the open Unity project.",
		parameters: projectActionParams,
		async execute(_callId, params, signal, _onUpdate, ctx) {
			const guarded = new Set([
				"menu",
				"build",
				"addPackage",
				"removePackage",
				"writeSettings",
				"quit",
			]);
			if (guarded.has(params.action) && params.confirm !== true) {
				return errorResult(
					`${params.action} changes the project or the Editor globally. Ask the user first, then call again with confirm:true.`,
				);
			}
			try {
				const root = unityProjectRoot(ctx.cwd);
				const bridgeOptions = signal ? { signal } : {};
				const result = await withUnityBridge(
					root,
					async (client) => {
						switch (params.action) {
							case "menu":
								return client.executeMenu(params.item ?? "", signal);
							case "build": {
								const started = await client.startBuild({
									...(params.target ? { target: params.target } : {}),
									...(params.outputPath ? { outputPath: params.outputPath } : {}),
									...(params.scenes ? { scenes: params.scenes } : {}),
									...(params.development === true ? { development: true } : {}),
									...(signal ? { signal } : {}),
								});
								return client.waitForBuild(started.buildId, {
									...(signal ? { signal } : {}),
								});
							}
							case "buildStatus":
								return client.waitForBuild(params.id ?? "", {
									timeoutMs: 5_000,
									...(signal ? { signal } : {}),
								});
							case "packages":
								return client.listPackages(signal);
							case "addPackage":
								return client.changePackage("add", params.id ?? "", signal);
							case "removePackage":
								return client.changePackage("remove", params.id ?? "", signal);
							case "settings":
								return client.readSettings(signal);
							case "writeSettings":
								return client.writeSettings(
									(params.settings ?? {}) as Partial<UnityPlayerSettingsValues> & {
										platform?: string;
									},
									signal,
								);
							case "profiler":
								return client.profilerSnapshot(signal);
							case "input":
								return client.queueInput(params.keys ?? [], {
									...(params.releaseAll === true ? { releaseAll: true } : {}),
									...(signal ? { signal } : {}),
								});
							case "quit":
								return client.quitEditor({
									...(params.save === true ? { save: true } : {}),
									...(params.discard === true ? { discard: true } : {}),
									...(signal ? { signal } : {}),
								});
						}
					},
					bridgeOptions,
				);
				return textResult(
					formatProjectAction(params.action, result),
					result as unknown as Record<string, unknown>,
				);
			} catch (error) {
				return errorResult(errorMessage(error));
			}
		},
	});
}
