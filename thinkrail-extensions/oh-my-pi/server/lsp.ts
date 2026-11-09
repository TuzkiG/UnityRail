import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";

interface DiagnosticRange {
	start: { line: number; character: number };
	end: { line: number; character: number };
}

export interface LspDiagnostic {
	range: DiagnosticRange;
	severity?: number;
	message: string;
}

export interface LspCommand {
	command: string;
	args: string[];
}

const DEFAULT_COMMANDS: Record<"ts" | "cs", LspCommand> = {
	ts: { command: "typescript-language-server", args: ["--stdio"] },
	cs: { command: "csharp-ls", args: [] },
};

const LANGUAGE_IDS: Record<string, string> = {
	".ts": "typescript",
	".tsx": "typescriptreact",
	".js": "javascript",
	".jsx": "javascriptreact",
	".cs": "csharp",
};

function familyFor(filePath: string): "ts" | "cs" | undefined {
	const lower = filePath.toLowerCase();
	if (
		lower.endsWith(".ts") ||
		lower.endsWith(".tsx") ||
		lower.endsWith(".js") ||
		lower.endsWith(".jsx")
	) {
		return "ts";
	}
	if (lower.endsWith(".cs")) return "cs";
	return undefined;
}

function parseCommand(value: string): LspCommand {
	const parts = value.trim().split(/\s+/);
	return { command: parts[0] ?? "", args: parts.slice(1) };
}

/** `ts=…; cs=…` in the setting overrides the default server per language family. */
export function parseLspCommands(value: string): Partial<Record<"ts" | "cs", LspCommand>> {
	const commands: Partial<Record<"ts" | "cs", LspCommand>> = {};
	for (const entry of value.split(";")) {
		const separator = entry.indexOf("=");
		if (separator < 0) continue;
		const key = entry.slice(0, separator).trim();
		const command = entry.slice(separator + 1).trim();
		if ((key === "ts" || key === "cs") && command !== "") commands[key] = parseCommand(command);
	}
	return commands;
}

export function lspCommandFor(
	filePath: string,
	overrides: Partial<Record<"ts" | "cs", LspCommand>>,
): { command: LspCommand; languageId: string } | undefined {
	const family = familyFor(filePath);
	if (family === undefined) return undefined;
	const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
	const languageId = LANGUAGE_IDS[extension];
	if (languageId === undefined) return undefined;
	return { command: overrides[family] ?? DEFAULT_COMMANDS[family], languageId };
}

class LspClient {
	private readonly child: ChildProcessWithoutNullStreams;
	private buffer = Buffer.alloc(0);
	private nextId = 1;
	private readonly pending = new Map<number, (value: unknown) => void>();
	private readonly diagnostics = new Map<string, LspDiagnostic[]>();
	private readonly waiters = new Map<string, (value: LspDiagnostic[]) => void>();
	private closed = false;

	private constructor(child: ChildProcessWithoutNullStreams) {
		this.child = child;
		child.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
		child.on("exit", () => this.fail());
	}

	static async start(command: LspCommand, root: string): Promise<LspClient> {
		const child = spawn(command.command, command.args, {
			cwd: root,
			stdio: ["pipe", "pipe", "pipe"],
			shell: process.platform === "win32",
			windowsHide: true,
		});
		const client = new LspClient(child);
		await client.request("initialize", {
			processId: process.pid,
			rootUri: pathToFileURL(root).href,
			capabilities: { textDocument: { publishDiagnostics: {} } },
			workspaceFolders: [
				{ uri: pathToFileURL(root).href, name: root.split(/[\\/]/).pop() ?? "root" },
			],
		});
		if (client.isClosed) {
			await client.dispose();
			throw new Error("lsp server exited during initialize");
		}
		client.send({ jsonrpc: "2.0", method: "initialized", params: {} });
		return client;
	}

	private send(message: unknown): void {
		if (this.closed) return;
		const body = JSON.stringify(message);
		this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
	}

	private receive(chunk: Buffer): void {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		while (true) {
			const headerEnd = this.buffer.indexOf("\r\n\r\n");
			if (headerEnd < 0) return;
			const header = this.buffer.subarray(0, headerEnd).toString("utf-8");
			const length = Number(/Content-Length: (\d+)/i.exec(header)?.[1]);
			if (!Number.isFinite(length) || length < 0) {
				this.buffer = this.buffer.subarray(headerEnd + 4);
				continue;
			}
			const bodyStart = headerEnd + 4;
			if (this.buffer.length < bodyStart + length) return;
			const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf-8");
			this.buffer = this.buffer.subarray(bodyStart + length);
			this.handle(JSON.parse(body) as Record<string, unknown>);
		}
	}

	private handle(message: Record<string, unknown>): void {
		if (message.method === "workspace/configuration" && message.id !== undefined) {
			this.send({ jsonrpc: "2.0", id: message.id, result: [] });
			return;
		}
		if (message.id !== undefined) {
			const id = Number(message.id);
			const resolve = this.pending.get(id);
			if (resolve !== undefined) {
				this.pending.delete(id);
				resolve(message.result);
			}
			return;
		}
		if (message.method === "textDocument/publishDiagnostics") {
			const params = message.params as { uri: string; diagnostics: LspDiagnostic[] };
			this.diagnostics.set(params.uri, params.diagnostics);
			this.waiters.get(params.uri)?.(params.diagnostics);
		}
	}

	private request(method: string, params: unknown): Promise<unknown> {
		const id = this.nextId++;
		return new Promise((resolveRequest) => {
			this.pending.set(id, resolveRequest);
			this.send({ jsonrpc: "2.0", id, method, params });
		});
	}

	async waitForDiagnostics(uri: string, timeoutMs: number): Promise<LspDiagnostic[] | undefined> {
		const ready = this.diagnostics.get(uri);
		if (ready !== undefined) return ready;
		return new Promise((resolveDiagnostics) => {
			const timer = setTimeout(() => {
				this.waiters.delete(uri);
				resolveDiagnostics(undefined);
			}, timeoutMs);
			this.waiters.set(uri, (value) => {
				clearTimeout(timer);
				this.waiters.delete(uri);
				resolveDiagnostics(value);
			});
		});
	}

	async open(filePath: string, languageId: string, text: string, timeoutMs: number) {
		const uri = pathToFileURL(filePath).href;
		this.diagnostics.delete(uri);
		this.send({
			jsonrpc: "2.0",
			method: "textDocument/didOpen",
			params: { textDocument: { uri, languageId, version: 1, text } },
		});
		const diagnostics = await this.waitForDiagnostics(uri, timeoutMs);
		this.send({
			jsonrpc: "2.0",
			method: "textDocument/didClose",
			params: { textDocument: { uri } },
		});
		return diagnostics;
	}

	private fail(): void {
		this.closed = true;
		for (const resolve of this.pending.values()) resolve(undefined);
		this.pending.clear();
	}

	get isClosed(): boolean {
		return this.closed;
	}

	async dispose(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		if (!this.child.killed) {
			await new Promise<void>((resolveExit) => {
				const timer = setTimeout(resolveExit, 1000);
				this.child.once("exit", () => {
					clearTimeout(timer);
					resolveExit();
				});
				this.child.kill();
			});
		}
		this.fail();
	}
}

const clients = new Map<string, Promise<LspClient | undefined>>();

function clientKey(root: string, command: LspCommand): string {
	return `${root}\u0000${command.command}\u0000${command.args.join("\u0000")}`;
}

async function clientFor(root: string, command: LspCommand): Promise<LspClient | undefined> {
	const key = clientKey(root, command);
	const existing = clients.get(key);
	if (existing !== undefined) {
		const client = await existing;
		return client?.isClosed === true ? undefined : client;
	}
	const started = LspClient.start(command, root).catch(() => undefined);
	clients.set(key, started);
	return started;
}

export async function shutdownLspClients(): Promise<void> {
	const started = [...clients.values()];
	clients.clear();
	await Promise.all(
		started.map(async (pending) => {
			const client = await pending;
			await client?.dispose();
		}),
	);
}

export async function collectDiagnostics(
	filePath: string,
	text: string,
	languageId: string,
	command: LspCommand,
	root: string,
	timeoutMs = 5000,
): Promise<LspDiagnostic[] | undefined> {
	const client = await clientFor(root, command);
	if (client === undefined) return undefined;
	return client.open(filePath, languageId, text, timeoutMs);
}

const SEVERITIES: Record<number, string> = { 1: "error", 2: "warning", 3: "info", 4: "hint" };

export function formatDiagnostics(
	filePath: string,
	diagnostics: readonly LspDiagnostic[],
): string[] {
	return diagnostics.slice(0, 20).map((diagnostic) => {
		const line = diagnostic.range.start.line + 1;
		const severity = SEVERITIES[diagnostic.severity ?? 1] ?? "error";
		const message =
			diagnostic.message.length > 500 ? `${diagnostic.message.slice(0, 500)}…` : diagnostic.message;
		return `${severity} ${filePath}:${line} ${message}`;
	});
}

export function registerLspDiagnostics(
	pi: Pick<ExtensionAPI, "on">,
	options: { root: string; commands: Partial<Record<"ts" | "cs", LspCommand>> },
): void {
	pi.on("tool_result", async (event: ToolResultEvent) => {
		if (
			event.toolName !== "edit" &&
			event.toolName !== "write" &&
			event.toolName !== "apply_patch"
		) {
			return undefined;
		}
		if (event.isError) return undefined;
		const filePath = event.input.path;
		if (typeof filePath !== "string" || filePath === "") return undefined;
		const absolutePath = isAbsolute(filePath) ? filePath : resolve(options.root, filePath);
		const selected = lspCommandFor(absolutePath, options.commands);
		if (selected === undefined) return undefined;
		const text = await readFile(absolutePath, "utf-8").catch(() => undefined);
		if (text === undefined) return undefined;
		const diagnostics = await collectDiagnostics(
			absolutePath,
			text,
			selected.languageId,
			selected.command,
			options.root,
		);
		if (diagnostics === undefined || diagnostics.length === 0) return undefined;
		const lines = formatDiagnostics(filePath, diagnostics);
		if (lines.length === 0) return undefined;
		return {
			content: [
				...event.content,
				{ type: "text" as const, text: `LSP diagnostics:\n${lines.join("\n")}` },
			],
			...(event.structuredContent === undefined
				? {}
				: { structuredContent: event.structuredContent }),
		};
	});

	pi.on("session_shutdown", async () => {
		await shutdownLspClients();
	});
}
