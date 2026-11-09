import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	defaultRulesDir,
	loadRules,
	matchTextRules,
	matchToolRule,
	registerRules,
	resolveRulesDir,
} from "./rules.ts";

const dirs: string[] = [];

async function workspace(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "oh-my-pi-rules-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeRule(dir: string, file: string, raw: string): Promise<void> {
	await writeFile(join(dir, file), raw, "utf-8");
}

describe("rule files", () => {
	it("parses tool and text rules from frontmatter", async () => {
		const dir = await workspace();
		await writeRule(
			dir,
			"no-console.md",
			"---\npattern: console\\.log\nscope: tool\ntools: edit, write\nfiles: *.ts\n---\nUse the logger, not console.log.",
		);
		await writeRule(
			dir,
			"todo.md",
			"---\npattern: TODO\nscope: text\n---\nClose every TODO before finishing.",
		);

		const rules = loadRules(dir);
		expect(rules.map((rule) => rule.name)).toEqual(["no-console", "todo"]);
		expect(rules[0]?.scope).toBe("tool");
		expect(rules[0]?.tools).toEqual(["edit", "write"]);
		expect(rules[1]?.body).toBe("Close every TODO before finishing.");
	});

	it("skips a rule with a broken pattern or missing scope", async () => {
		const dir = await workspace();
		await writeRule(dir, "bad-regex.md", "---\npattern: (unclosed\nscope: text\n---\nBody.");
		await writeRule(dir, "no-scope.md", "---\npattern: x\n---\nBody.");
		await writeRule(dir, "good.md", "---\npattern: never\nscope: text\n---\nStill loaded.");

		expect(loadRules(dir).map((rule) => rule.name)).toEqual(["good"]);
	});
});

describe("rule matching", () => {
	it("matches a tool rule only inside its tools and file glob", async () => {
		const dir = await workspace();
		await writeRule(
			dir,
			"no-console.md",
			"---\npattern: console\\.log\nscope: tool\ntools: edit,write\nfiles: *.ts\n---\nUse the logger, not console.log.",
		);
		const rules = loadRules(dir);

		expect(
			matchToolRule(rules, "edit", { path: "src/a.ts", ops: [{ text: "console.log(1)" }] })?.name,
		).toBe("no-console");
		expect(
			matchToolRule(rules, "edit", { path: "src/a.md", text: "console.log(1)" }),
		).toBeUndefined();
		expect(matchToolRule(rules, "bash", { command: "console.log(1)" })).toBeUndefined();
	});

	it("returns every matching text rule", async () => {
		const dir = await workspace();
		await writeRule(dir, "todo.md", "---\npattern: TODO\nscope: text\n---\nClose TODOs.");
		await writeRule(dir, "sorry.md", "---\npattern: sorry\nscope: text\n---\nNever apologize.");
		await writeRule(dir, "tool.md", "---\npattern: TODO\nscope: tool\n---\nWrong scope.");

		const matched = matchTextRules(loadRules(dir), "A TODO is left, sorry.");
		expect(matched.map((rule) => rule.name).sort()).toEqual(["sorry", "todo"]);
	});
});

describe("rule hooks", () => {
	it("blocks a matching tool call and retries a matching turn once", async () => {
		const dir = await workspace();
		await writeRule(
			dir,
			"no-console.md",
			"---\npattern: console\\.log\nscope: tool\ntools: edit\n---\nUse the logger, not console.log.",
		);
		await writeRule(dir, "todo.md", "---\npattern: TODO\nscope: text\n---\nClose TODOs.");

		const handlers = new Map<string, (event: unknown) => unknown>();
		const pi = {
			on: (event: string, handler: (payload: unknown) => unknown) => {
				handlers.set(event, handler);
			},
		} as unknown as Pick<ExtensionAPI, "on">;
		registerRules(pi, dir);

		const block = await handlers.get("tool_call")?.({
			type: "tool_call",
			toolName: "edit",
			input: { path: "a.ts", ops: [{ text: "console.log(1)" }] },
		});
		expect(block).toEqual({
			block: true,
			reason: "Rule no-console matched.\n\nUse the logger, not console.log.",
		});

		const message = { role: "assistant", content: [{ type: "text", text: "One TODO left." }] };
		const first = (await handlers.get("turn_end")?.({ type: "turn_end", message })) as {
			entries: { content: string; display: boolean }[];
			continue?: boolean;
		};
		expect(first.continue).toBe(true);
		expect(first.entries[0]?.content).toContain("Close TODOs.");
		expect(first.entries[0]?.display).toBe(true);

		const second = (await handlers.get("turn_end")?.({ type: "turn_end", message })) as {
			entries: unknown[];
			continue?: boolean;
		};
		expect(second.continue).toBeUndefined();
		expect(second.entries).toHaveLength(1);
	});

	it("does nothing when the rules directory is empty", () => {
		const handlers = new Map<string, unknown>();
		const pi = {
			on: (event: string, handler: unknown) => {
				handlers.set(event, handler);
			},
		} as unknown as Pick<ExtensionAPI, "on">;
		registerRules(pi, join(tmpdir(), "oh-my-pi-missing-rules"));
		expect(handlers.size).toBe(0);
	});
});

describe("rule directory", () => {
	it("defaults to the pi agent rules directory and expands a home path", () => {
		expect(defaultRulesDir()).toEndWith(join(".pi", "agent", "oh-my-pi", "rules"));
		expect(resolveRulesDir("")).toBe(defaultRulesDir());
		expect(resolveRulesDir("~/rules")).toEndWith(join("rules"));
	});
});
