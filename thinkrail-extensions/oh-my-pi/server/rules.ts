import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import type {
	ExtensionAPI,
	ToolCallEvent,
	ToolCallEventResult,
	TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

export interface Rule {
	name: string;
	pattern: RegExp;
	scope: "tool" | "text";
	tools?: string[];
	files?: RegExp;
	body: string;
}

export function defaultRulesDir(): string {
	return join(homedir(), ".pi", "agent", "oh-my-pi", "rules");
}

export function resolveRulesDir(configured: string): string {
	const trimmed = configured.trim();
	if (trimmed === "") return defaultRulesDir();
	if (trimmed === "~") return homedir();
	if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
	return isAbsolute(trimmed) ? trimmed : resolve(trimmed);
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } | undefined {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return undefined;
	const meta: Record<string, string> = {};
	for (const line of (match[1] ?? "").split(/\r?\n/)) {
		const entry = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
		if (entry?.[1] !== undefined) meta[entry[1]] = entry[2]?.trim() ?? "";
	}
	return { meta, body: (match[2] ?? "").trim() };
}

function globToRegExp(glob: string): RegExp {
	let source = "";
	for (let index = 0; index < glob.length; index += 1) {
		const char = glob[index];
		if (char === "*") {
			if (glob[index + 1] === "*") {
				source += ".*";
				index += 1;
				if (glob[index + 1] === "/") index += 1;
			} else {
				source += "[^/]*";
			}
		} else if (char === "?") {
			source += "[^/]";
		} else if ("\\^$.|+()[]{}".includes(char ?? "")) {
			source += `\\${char}`;
		} else {
			source += char ?? "";
		}
	}
	return new RegExp(`^${source}$`);
}

function parseRule(file: string, raw: string): Rule | undefined {
	const parsed = parseFrontmatter(raw);
	if (!parsed) return undefined;
	const { meta, body } = parsed;
	const scope = meta.scope === "text" ? "text" : meta.scope === "tool" ? "tool" : undefined;
	if (scope === undefined || meta.pattern === undefined || body === "") return undefined;
	let pattern: RegExp;
	try {
		pattern = new RegExp(meta.pattern, "m");
	} catch {
		return undefined;
	}
	const tools = meta.tools
		?.split(",")
		.map((tool) => tool.trim())
		.filter(Boolean);
	const files = meta.files === undefined ? undefined : globToRegExp(meta.files);
	return {
		name: basename(file, ".md"),
		pattern,
		scope,
		...(tools === undefined || tools.length === 0 ? {} : { tools }),
		...(files === undefined ? {} : { files }),
		body,
	};
}

export function loadRules(dir: string): Rule[] {
	let files: string[];
	try {
		files = readdirSync(dir).filter((file) => file.endsWith(".md"));
	} catch {
		return [];
	}
	const rules: Rule[] = [];
	for (const file of files.sort()) {
		let raw: string;
		try {
			raw = readFileSync(join(dir, file), "utf-8");
		} catch {
			continue;
		}
		const rule = parseRule(file, raw);
		if (rule === undefined) {
			console.warn(
				`oh-my-pi: skipping rule ${file}; it needs a pattern, a tool|text scope and a body.`,
			);
			continue;
		}
		rules.push(rule);
	}
	return rules;
}

function matchesFiles(rule: Rule, input: Record<string, unknown>): boolean {
	if (rule.files === undefined) return true;
	if (typeof input.path !== "string") return false;
	const candidate = input.path.replaceAll("\\", "/");
	return rule.files.test(candidate) || rule.files.test(basename(candidate));
}

function searchableInput(input: Record<string, unknown>): string {
	try {
		return JSON.stringify(input);
	} catch {
		return "";
	}
}

export function matchToolRule(
	rules: readonly Rule[],
	toolName: string,
	input: Record<string, unknown>,
): Rule | undefined {
	const haystack = `${toolName}\n${searchableInput(input)}`;
	return rules.find(
		(rule) =>
			rule.scope === "tool" &&
			(rule.tools === undefined || rule.tools.includes(toolName)) &&
			matchesFiles(rule, input) &&
			rule.pattern.test(haystack),
	);
}

export function matchTextRules(rules: readonly Rule[], text: string): Rule[] {
	return rules.filter((rule) => rule.scope === "text" && rule.pattern.test(text));
}

function assistantText(message: unknown): string {
	if (typeof message !== "object" || message === null) return "";
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(block): block is { type: "text"; text: string } =>
				typeof block === "object" &&
				block !== null &&
				(block as { type?: unknown }).type === "text" &&
				typeof (block as { text?: unknown }).text === "string",
		)
		.map((block) => block.text)
		.join("\n");
}

export function registerRules(pi: Pick<ExtensionAPI, "on">, rulesDir: string): void {
	const rules = loadRules(resolveRulesDir(rulesDir));
	if (rules.length === 0) return;
	const retried = new Set<string>();

	pi.on("tool_call", (event: ToolCallEvent): ToolCallEventResult | undefined => {
		const rule = matchToolRule(rules, event.toolName, event.input as Record<string, unknown>);
		if (rule === undefined) return undefined;
		return { block: true, reason: `Rule ${rule.name} matched.\n\n${rule.body}` };
	});

	pi.on("turn_end", (event: TurnEndEvent) => {
		const text = assistantText(event.message);
		if (text === "") return undefined;
		const matched = matchTextRules(rules, text);
		if (matched.length === 0) return undefined;
		const fresh = matched.filter((rule) => !retried.has(rule.name));
		for (const rule of fresh) retried.add(rule.name);
		return {
			entries: matched.map((rule) => ({
				type: "custom_message" as const,
				customType: "oh-my-pi-rule",
				content: `Rule ${rule.name} matched.\n\n${rule.body}`,
				display: true,
			})),
			...(fresh.length === 0 ? {} : { continue: true }),
		};
	});
}
