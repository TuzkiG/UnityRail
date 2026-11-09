import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	collectDiagnostics,
	formatDiagnostics,
	lspCommandFor,
	parseLspCommands,
	registerLspDiagnostics,
	shutdownLspClients,
} from "./lsp.ts";

const dirs: string[] = [];

async function workspace(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "oh-my-pi-lsp-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await shutdownLspClients();
	await Promise.all(
		dirs
			.splice(0)
			.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
	);
});

const FAKE_SERVER = `
let buffer = Buffer.alloc(0);
const send = (message) => {
  const body = JSON.stringify(message);
  process.stdout.write(\`Content-Length: \${Buffer.byteLength(body)}\\r\\n\\r\\n\${body}\`);
};
const handle = (message) => {
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { capabilities: { textDocumentSync: 1 } } });
  } else if (message.method === "textDocument/didOpen") {
    const uri = message.params.textDocument.uri;
    send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [
      { range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } }, severity: 2, message: "unused variable" },
      { range: { start: { line: 3, character: 0 }, end: { line: 3, character: 1 } }, severity: 1, message: "broken" },
    ] } });
  } else if (message.id !== undefined) {
    send({ jsonrpc: "2.0", id: message.id, result: null });
  }
};
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd < 0) return;
    const length = Number(/Content-Length: (\\d+)/i.exec(buffer.subarray(0, headerEnd).toString())[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) return;
    const body = buffer.subarray(bodyStart, bodyStart + length).toString();
    buffer = buffer.subarray(bodyStart + length);
    handle(JSON.parse(body));
  }
});
`;

describe("lsp settings", () => {
	it("parses per-language overrides and resolves the default command", () => {
		const overrides = parseLspCommands(
			"ts=npx typescript-language-server --stdio; cs=dotnet csharp-ls",
		);
		expect(overrides.ts).toEqual({
			command: "npx",
			args: ["typescript-language-server", "--stdio"],
		});
		expect(lspCommandFor("/a/b.ts", overrides)?.command.command).toBe("npx");
		expect(lspCommandFor("/a/b.cs", {})?.command.command).toBe("csharp-ls");
		expect(lspCommandFor("/a/b.md", {})).toBeUndefined();
	});

	it("formats severity, path, line and truncates a long message", () => {
		const lines = formatDiagnostics("src/a.ts", [
			{
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
				severity: 1,
				message: "boom",
			},
			{
				range: { start: { line: 4, character: 0 }, end: { line: 4, character: 1 } },
				severity: 2,
				message: "x".repeat(600),
			},
		]);
		expect(lines[0]).toBe("error src/a.ts:1 boom");
		expect(lines[1]?.startsWith("warning src/a.ts:5 ")).toBe(true);
		expect(lines[1]?.endsWith("…")).toBe(true);
		expect(lines[1]?.length).toBe("warning src/a.ts:5 ".length + 501);
	});
});

describe("lsp client", () => {
	it("collects diagnostics published after didOpen", async () => {
		const dir = await workspace();
		const script = join(dir, "fake-lsp.mjs");
		await writeFile(script, FAKE_SERVER, "utf-8");
		const file = join(dir, "a.ts");
		await writeFile(file, "const a = 1;\nconst b = 2;\n", "utf-8");

		const diagnostics = await collectDiagnostics(
			file,
			"const a = 1;\n",
			"typescript",
			{
				command: process.execPath,
				args: [script],
			},
			process.cwd(),
		);
		expect(diagnostics?.map((diagnostic) => diagnostic.message)).toEqual([
			"unused variable",
			"broken",
		]);
	});

	it("returns undefined when the server command does not exist", async () => {
		const dir = await workspace();
		const diagnostics = await collectDiagnostics(
			"/missing.ts",
			"x",
			"typescript",
			{
				command: join(dir, "does-not-exist"),
				args: [],
			},
			process.cwd(),
		);
		expect(diagnostics).toBeUndefined();
	});
});

describe("lsp tool result hook", () => {
	it("appends diagnostics from the real file after an edit", async () => {
		const dir = await workspace();
		const script = join(dir, "fake-lsp.mjs");
		await writeFile(script, FAKE_SERVER, "utf-8");
		const file = join(dir, "a.ts");
		await writeFile(file, "const a = 1;\n", "utf-8");

		const handlers = new Map<string, (event: unknown) => unknown>();
		const pi = {
			on: (event: string, handler: (payload: unknown) => unknown) => {
				handlers.set(event, handler);
			},
		} as unknown as Pick<ExtensionAPI, "on">;
		registerLspDiagnostics(pi, {
			root: process.cwd(),
			commands: { ts: { command: process.execPath, args: [script] } },
		});

		const content = [{ type: "text" as const, text: "Successfully edited." }];
		const result = (await handlers.get("tool_result")?.({
			type: "tool_result",
			toolName: "edit",
			input: { path: file },
			content,
			isError: false,
		})) as { content: { type: string; text: string }[] };
		expect(result.content).toHaveLength(2);
		expect(result.content[1]?.text).toContain(`error ${file}:4 broken`);
		expect(result.content[1]?.text).toContain(`warning ${file}:2 unused variable`);
	});

	it("stays silent for a failed tool result or an unknown extension", async () => {
		const dir = await workspace();
		const handlers = new Map<string, (event: unknown) => unknown>();
		const pi = {
			on: (event: string, handler: (payload: unknown) => unknown) => {
				handlers.set(event, handler);
			},
		} as unknown as Pick<ExtensionAPI, "on">;
		registerLspDiagnostics(pi, { root: dir, commands: {} });

		const handler = handlers.get("tool_result");
		expect(
			await handler?.({
				type: "tool_result",
				toolName: "edit",
				input: { path: "a.ts" },
				content: [],
				isError: true,
			}),
		).toBeUndefined();
		expect(
			await handler?.({
				type: "tool_result",
				toolName: "edit",
				input: { path: "a.md" },
				content: [],
				isError: false,
			}),
		).toBeUndefined();
		expect(
			await handler?.({
				type: "tool_result",
				toolName: "bash",
				input: { path: "a.ts" },
				content: [],
				isError: false,
			}),
		).toBeUndefined();
	});
});

describe("lsp uri", () => {
	it("uses a file URL for the opened document", () => {
		expect(pathToFileURL(join("a", "b.ts")).href).toContain("b.ts");
	});
});
