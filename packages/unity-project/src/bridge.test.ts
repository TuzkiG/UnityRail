import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { UnityBridgeStatus } from "./index.ts";
import {
	connectUnityBridge,
	readUnityBridgeDiscovery,
	UNITY_BRIDGE_PROTOCOL_VERSION,
	UnityBridgeClient,
	UnityBridgeError,
	withUnityBridge,
} from "./index.ts";
import { createUnityFixture, ONE_PIXEL_PNG_BASE64, writeBridgeFile } from "./test/fixture.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";
const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function fixture() {
	const created = createUnityFixture();
	cleanups.push(created.cleanup);
	return created;
}

interface MockState {
	compileId: number;
	compilePolls: number;
	compileState: "compiling" | "succeeded" | "failed";
	failCompile: boolean;
	testPolls: number;
	isPlaying: boolean;
	requests: string[];
	bodies: unknown[];
	token: string;
	statusPayload?: unknown;
	consolePayload?: unknown;
	hierarchyPayload?: unknown;
	testStatusPayload?: unknown;
	onStatus?: (state: MockState) => void;
	onTestStatus?: (state: MockState) => void;
}

const SECOND_TOKEN = "fedcba9876543210fedcba9876543210";

function mockBridge(projectPath: string, overrides: Partial<MockState> = {}) {
	const state: MockState = {
		compileId: 0,
		compilePolls: 0,
		compileState: "succeeded",
		failCompile: false,
		testPolls: 0,
		isPlaying: false,
		requests: [],
		bodies: [],
		token: TOKEN,
		...overrides,
	};
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			const url = new URL(request.url);
			state.requests.push(`${request.method} ${url.pathname}`);
			if (request.headers.get("authorization") !== `Bearer ${state.token}`) {
				return new Response("unauthorized", { status: 401 });
			}
			if (url.pathname === "/v1/health")
				return Response.json({ ok: true, protocolVersion: UNITY_BRIDGE_PROTOCOL_VERSION });
			if (url.pathname === "/v1/status") {
				state.onStatus?.(state);
				if (state.statusPayload !== undefined) return Response.json(state.statusPayload);
				if (state.compileState === "compiling") {
					state.compilePolls += 1;
					if (state.compilePolls >= 2)
						state.compileState = state.failCompile ? "failed" : "succeeded";
				}
				const status: UnityBridgeStatus = {
					protocolVersion: UNITY_BRIDGE_PROTOCOL_VERSION,
					port: server.port ?? 0,
					projectPath,
					unityVersion: "6000.0.23f1",
					bridgeStartedAt: new Date().toISOString(),
					isPlaying: state.isPlaying,
					isPaused: false,
					isCompiling: state.compileState === "compiling",
					isUpdating: false,
					applicationPath: "C:/Program Files/Unity/Editor/Unity.exe",
					platform: "WindowsEditor",
					activeScene: "Assets/Scenes/Main.unity",
					selection: [],
					consoleSeq: 3,
					lastCompile:
						state.compileId === 0
							? null
							: {
									id: state.compileId,
									state: state.compileState,
									startedAt: new Date().toISOString(),
									...(state.compileState === "compiling"
										? {}
										: { finishedAt: new Date().toISOString(), durationMs: 1200 }),
									diagnostics:
										state.compileState === "succeeded"
											? []
											: [
													{
														severity: "error",
														message: "CS0103: The name 'Foo' does not exist",
														file: "Assets/Scripts/Game.cs",
														line: 4,
														column: 9,
													},
												],
								},
				};
				return Response.json(status);
			}
			if (url.pathname === "/v1/compile" && request.method === "POST") {
				state.compileId += 1;
				state.compilePolls = 0;
				state.compileState = "compiling";
				return Response.json({ compileId: state.compileId, state: "compiling" });
			}
			if (url.pathname === "/v1/console" && request.method === "GET") {
				if (state.consolePayload !== undefined) return Response.json(state.consolePayload);
				const since = Number(url.searchParams.get("since") ?? "0");
				const entries = [
					{ seq: 1, time: "t1", level: "log", message: "hello" },
					{ seq: 2, time: "t2", level: "warning", message: "careful" },
					{ seq: 3, time: "t3", level: "error", message: "boom" },
				].filter((entry) => entry.seq > since);
				return Response.json({ entries, nextSeq: 3, dropped: 0 });
			}
			if (url.pathname === "/v1/playmode" && request.method === "POST") {
				state.isPlaying = true;
				return Response.json({ ok: true });
			}
			if (url.pathname === "/v1/screenshot") {
				return new Response(Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"), {
					headers: { "Content-Type": "image/png" },
				});
			}
			if (url.pathname === "/v1/tests" && request.method === "POST") {
				return Response.json({ runId: "run-1" });
			}
			if (url.pathname === "/v1/tests/status") {
				state.onTestStatus?.(state);
				if (state.testStatusPayload !== undefined) return Response.json(state.testStatusPayload);
				state.testPolls += 1;
				const running = state.testPolls < 2;
				return Response.json({
					runId: "run-1",
					mode: "edit",
					state: running ? "running" : "passed",
					startedAt: new Date().toISOString(),
					passed: running ? 0 : 2,
					failed: 0,
					skipped: 0,
					results: running
						? []
						: [
								{ name: "Passes", fullName: "Tests.Passes", status: "passed", durationMs: 10 },
								{ name: "Also", fullName: "Tests.Also", status: "passed", durationMs: 5 },
							],
				});
			}
			if (url.pathname === "/v1/hierarchy") {
				if (state.hierarchyPayload !== undefined) return Response.json(state.hierarchyPayload);
				return Response.json({
					scene: "Main",
					scenePath: "Assets/Scenes/Main.unity",
					roots: [
						{
							name: "Main",
							path: "Main",
							scene: "Main",
							activeSelf: true,
							activeInHierarchy: true,
							instanceId: 1,
							components: [{ type: "Transform", enabled: true, instanceId: 2 }],
							children: [],
						},
					],
					truncated: false,
				});
			}
			if (url.pathname === "/v1/inspect") {
				return Response.json({
					name: "Main",
					path: "Main",
					scene: "Main",
					tag: "Untagged",
					layer: 0,
					isStatic: false,
					activeSelf: true,
					instanceId: 1,
					components: [{ type: "Transform", enabled: true, instanceId: 2, properties: [] }],
				});
			}
			if (url.pathname === "/v1/find") {
				return Response.json([
					{ name: "Main", path: "Assets/Scenes/Main.unity", guid: "abc", type: "SceneAsset" },
				]);
			}
			if (url.pathname === "/v1/open" || url.pathname === "/v1/select") {
				return Response.json({ ok: true });
			}
			if (url.pathname === "/v1/tools") {
				if (request.method === "GET") {
					return Response.json({
						ok: true,
						tools: [
							{
								name: "bake_tiles",
								description: "Bake the tilemap into a texture.",
								parameters: "output: Assets/Textures",
							},
						],
					});
				}
				state.bodies.push(await request.json());
				return Response.json({ ok: true, name: "bake_tiles", result: { textures: 2 } });
			}
			if (url.pathname === "/v1/scene/object" && request.method === "POST") {
				state.bodies.push(await request.json());
				return Response.json({
					ok: true,
					path: "Root/Player",
					instanceId: 7,
					created: false,
					components: ["BoxCollider"],
					saved: false,
				});
			}
			if (url.pathname === "/v1/component" && request.method === "POST") {
				state.bodies.push(await request.json());
				return Response.json({
					ok: true,
					path: "Root/Player",
					component: "BoxCollider",
					instanceId: 9,
					added: false,
					saved: false,
				});
			}
			return new Response("not found", { status: 404 });
		},
	});
	cleanups.push(() => server.stop(true));
	return { server, state };
}

function writeDiscovery(root: string, port: number, projectPath = root, token = TOKEN) {
	writeBridgeFile(join(root, "Library", "ThinkRailBridge.json"), {
		protocolVersion: UNITY_BRIDGE_PROTOCOL_VERSION,
		port,
		token,
		pid: process.pid,
		projectPath,
		unityVersion: "6000.0.23f1",
		startedAt: new Date().toISOString(),
	});
}

describe("Unity bridge client", () => {
	test("reads status through a discovery file", async () => {
		const created = fixture();
		const { server } = mockBridge(created.root);
		writeDiscovery(created.root, server.port ?? 0);
		const connection = await connectUnityBridge(created.root);
		const status = await connection.client.status();
		expect(status.projectPath).toBe(created.root);
		expect(status.activeScene).toBe("Assets/Scenes/Main.unity");
		expect(status.lastCompile).toBeNull();
	});

	test("refuses a bridge that has a different project open", async () => {
		const created = fixture();
		const { server } = mockBridge(created.root);
		writeDiscovery(created.root, server.port ?? 0, "C:\\Other\\Game");
		await expect(connectUnityBridge(created.root)).rejects.toMatchObject({
			code: "BRIDGE_PROJECT_MISMATCH",
		});
	});

	test("reports a missing bridge with actionable guidance", async () => {
		const created = fixture();
		await expect(connectUnityBridge(created.root)).rejects.toMatchObject({
			code: "BRIDGE_NOT_RUNNING",
		});
	});

	test("turns a rejected token into BRIDGE_AUTH", async () => {
		const created = fixture();
		const { server } = mockBridge(created.root);
		writeDiscovery(created.root, server.port ?? 0);
		const connection = await connectUnityBridge(created.root);
		const wrongToken = { ...connection.discovery, token: "ffffffffffffffffffffffffffffffff" };
		const client = new UnityBridgeClient(wrongToken);
		await expect(client.status()).rejects.toMatchObject({ code: "BRIDGE_AUTH" });
	});

	test("reconnects with a rotated token and port during compile polling", async () => {
		const created = fixture();
		const rotated = mockBridge(created.root, {
			compileId: 2,
			compileState: "succeeded",
			token: SECOND_TOKEN,
		});
		const initial = mockBridge(created.root, {
			compileId: 1,
			compileState: "compiling",
			onStatus: (state) => {
				state.token = SECOND_TOKEN;
				writeDiscovery(created.root, rotated.server.port ?? 0, created.root, SECOND_TOKEN);
			},
		});
		writeDiscovery(created.root, initial.server.port ?? 0);
		const connection = await connectUnityBridge(created.root);
		const result = await connection.client.compile({ timeoutMs: 10_000 });
		expect(result.id).toBe(2);
		expect(result.state).toBe("succeeded");
		expect(connection.client.discovery.port).toBe(rotated.server.port ?? 0);
		expect(connection.client.discovery.token).toBe(SECOND_TOKEN);
	});

	test("gives up after three poll failures while the discovery file is unchanged", async () => {
		const created = fixture();
		const { server } = mockBridge(created.root, {
			compileState: "compiling",
			onStatus: () => {
				setTimeout(() => server.stop(true), 0);
			},
		});
		writeDiscovery(created.root, server.port ?? 0);
		const connection = await connectUnityBridge(created.root);
		await expect(connection.client.compile({ timeoutMs: 30_000 })).rejects.toMatchObject({
			code: "BRIDGE_UNAVAILABLE",
		});
	});

	test("keeps polling when the discovery file changes during a test run", async () => {
		const created = fixture();
		const rotated = mockBridge(created.root, {
			token: SECOND_TOKEN,
			testStatusPayload: {
				runId: "run-1",
				mode: "edit",
				state: "passed",
				startedAt: new Date().toISOString(),
				finishedAt: new Date().toISOString(),
				durationMs: 25,
				passed: 3,
				failed: 0,
				skipped: 0,
				results: [],
			},
		});
		const initial = mockBridge(created.root, {
			onTestStatus: (state) => {
				state.token = SECOND_TOKEN;
				writeDiscovery(created.root, rotated.server.port ?? 0, created.root, SECOND_TOKEN);
			},
		});
		writeDiscovery(created.root, initial.server.port ?? 0);
		const connection = await connectUnityBridge(created.root);
		const result = await connection.client.runTests({ mode: "edit", timeoutMs: 10_000 });
		expect(result.passed).toBe(3);
		expect(connection.client.discovery.port).toBe(rotated.server.port ?? 0);
	});

	test("surfaces the bridge's own failure message, not a bare status", async () => {
		const created = fixture();
		const server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch(request) {
				const url = new URL(request.url);
				if (url.pathname === "/v1/status") {
					return Response.json(
						{
							error: {
								code: "REQUEST_FAILED",
								message: "The open scene has unsaved changes.",
							},
						},
						{ status: 409 },
					);
				}
				return new Response("not found", { status: 404 });
			},
		});
		cleanups.push(() => server.stop(true));
		writeDiscovery(created.root, server.port ?? 0);
		await expect(
			withUnityBridge(created.root, (client) => client.status(), { retryUnavailable: true }),
		).rejects.toThrow("The open scene has unsaved changes.");
	});

	test("polls compile status until the compile finishes", async () => {
		const created = fixture();
		const { server, state } = mockBridge(created.root);
		writeDiscovery(created.root, server.port ?? 0);
		const result = await withUnityBridge(created.root, (client) =>
			client.compile({ timeoutMs: 5_000 }),
		);
		expect(result.id).toBe(1);
		expect(result.state).toBe("succeeded");
		expect(state.compileId).toBe(1);
		expect(result.diagnostics).toEqual([]);
	});

	test("returns failed compile diagnostics", async () => {
		const created = fixture();
		const { server } = mockBridge(created.root, { failCompile: true });
		writeDiscovery(created.root, server.port ?? 0);
		const result = await withUnityBridge(created.root, (client) =>
			client.compile({ timeoutMs: 5_000 }),
		);
		expect(result.state).toBe("failed");
		expect(result.diagnostics[0]?.message).toContain("CS0103");
	});

	test("reads console entries since a sequence number", async () => {
		const created = fixture();
		const { server } = mockBridge(created.root);
		writeDiscovery(created.root, server.port ?? 0);
		const page = await withUnityBridge(created.root, (client) => client.console({ since: 1 }));
		expect(page.entries.map((entry) => entry.seq)).toEqual([2, 3]);
		expect(page.nextSeq).toBe(3);
	});

	test("decodes a PNG screenshot", async () => {
		const created = fixture();
		const { server } = mockBridge(created.root);
		writeDiscovery(created.root, server.port ?? 0);
		const shot = await withUnityBridge(created.root, (client) => client.screenshot("game"));
		expect(shot.mimeType).toBe("image/png");
		expect(shot.width).toBe(1);
		expect(shot.height).toBe(1);
		expect(shot.bytes).toBeGreaterThan(0);
	});

	test("polls a test run to completion", async () => {
		const created = fixture();
		const { server } = mockBridge(created.root);
		writeDiscovery(created.root, server.port ?? 0);
		const result = await withUnityBridge(created.root, (client) =>
			client.runTests({ mode: "edit", timeoutMs: 5_000 }),
		);
		expect(result.state).toBe("passed");
		expect(result.passed).toBe(2);
		expect(result.results).toHaveLength(2);
	});

	test("reads hierarchy, inspection and asset search", async () => {
		const created = fixture();
		const { server } = mockBridge(created.root);
		writeDiscovery(created.root, server.port ?? 0);
		const result = await withUnityBridge(created.root, async (client) => ({
			hierarchy: await client.hierarchy(),
			inspection: await client.inspect("Main"),
			assets: await client.find("Main", { type: "SceneAsset" }),
		}));
		expect(result.hierarchy.roots[0]?.name).toBe("Main");
		expect(result.inspection.components[0]?.type).toBe("Transform");
		expect(result.assets[0]?.path).toBe("Assets/Scenes/Main.unity");
	});

	test("lists and invokes the project's [BridgeTool] editor tools", async () => {
		const created = fixture();
		const { server, state } = mockBridge(created.root);
		writeDiscovery(created.root, server.port ?? 0);
		const result = await withUnityBridge(created.root, async (client) => ({
			tools: await client.listEditorTools(),
			invocation: await client.invokeEditorTool("bake_tiles", { output: "Assets/Textures" }),
		}));
		expect(result.tools).toEqual([
			{
				name: "bake_tiles",
				description: "Bake the tilemap into a texture.",
				parameters: "output: Assets/Textures",
			},
		]);
		expect(result.invocation.result).toEqual({ textures: 2 });
		expect(state.bodies.at(-1)).toEqual({
			name: "bake_tiles",
			parameters: { output: "Assets/Textures" },
		});
	});

	test("passes ensure to scene writes and reads what the bridge actually changed", async () => {
		const created = fixture();
		const { server, state } = mockBridge(created.root);
		writeDiscovery(created.root, server.port ?? 0);
		const result = await withUnityBridge(created.root, async (client) => ({
			created: await client.createObject({
				name: "Player",
				components: ["BoxCollider"],
				ensure: true,
			}),
			added: await client.addComponent("Root/Player", "BoxCollider", { ensure: true }),
		}));
		expect(state.bodies[0]).toMatchObject({ name: "Player", ensure: true });
		expect(result.created.created).toBe(false);
		expect(state.bodies[1]).toMatchObject({
			path: "Root/Player",
			component: "BoxCollider",
			ensure: true,
		});
		expect(result.added.added).toBe(false);
	});

	test("flags an unsupported bridge protocol", async () => {
		const created = fixture();
		const { server } = mockBridge(created.root);
		writeBridgeFile(join(created.root, "Library", "ThinkRailBridge.json"), {
			protocolVersion: 99,
			port: server.port ?? 0,
			token: TOKEN,
			pid: process.pid,
			projectPath: created.root,
			unityVersion: "6000.0.23f1",
			startedAt: new Date().toISOString(),
		});
		await expect(connectUnityBridge(created.root)).rejects.toBeInstanceOf(UnityBridgeError);
		await expect(connectUnityBridge(created.root)).rejects.toMatchObject({
			code: "BRIDGE_PROTOCOL_MISMATCH",
		});
	});

	test("discovers the local file through the project model", async () => {
		const created = fixture();
		const { server } = mockBridge(created.root);
		writeDiscovery(created.root, server.port ?? 0);
		expect(readUnityBridgeDiscovery(created.root)?.port).toBe(server.port ?? 0);
	});
});
