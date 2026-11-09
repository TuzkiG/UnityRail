import type {
	ExtensionAPI,
	ExtensionContext,
	ModelRegistry,
	TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { type CredentialPool, completeWithRotation } from "./credentials.ts";

const ADVISOR_SYSTEM_PROMPT = `You are an advisor watching another agent work.
Read the excerpt and reply with at most two sentences of advice for the main agent.
Point out a concrete risk, a missed requirement, or a cheaper next step. If nothing is worth
saying, reply with "OK". Do not restate what the agent already did, do not use tools, and never
address the user.`;

export const ADVISOR_MAX_CALLS = 10;
const ADVISOR_MAX_TOKENS = 400;
const EXCERPT_LIMIT = 4000;

type Complete = ModelRegistry["complete"];
type AdvisorModel = Parameters<Complete>[0];
type AdvisorContext = Parameters<Complete>[1];

export interface AdvisorOptions {
	modelRef: string;
	maxCalls?: number;
	apiKeys?: CredentialPool;
	onWarn?: (message: string) => void;
}

export function resolveAdvisorModel(ctx: ExtensionContext, ref: string): AdvisorModel | undefined {
	const trimmed = ref.trim();
	if (!trimmed) return ctx.model;
	const slash = trimmed.indexOf("/");
	if (slash <= 0) return undefined;
	return ctx.modelRegistry.find(trimmed.slice(0, slash), trimmed.slice(slash + 1));
}

export function summarizeTurn(event: TurnEndEvent): string {
	const parts: string[] = [];
	if (event.message.role === "assistant") {
		const text = event.message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n")
			.trim();
		if (text) parts.push(`Assistant:\n${text}`);
	}
	for (const result of event.toolResults) {
		const text = result.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n")
			.trim();
		if (text) parts.push(`Tool ${result.toolName}:\n${text}`);
	}
	const excerpt = parts.join("\n\n");
	return excerpt.length > EXCERPT_LIMIT ? `${excerpt.slice(0, EXCERPT_LIMIT)}…` : excerpt;
}

export function registerAdvisor(pi: ExtensionAPI, options: AdvisorOptions): void {
	const maxCalls = options.maxCalls ?? ADVISOR_MAX_CALLS;
	let calls = 0;
	let warnedMissingModel = false;

	pi.on("turn_end", async (event, ctx) => {
		if (calls >= maxCalls) return;
		const excerpt = summarizeTurn(event);
		if (!excerpt) return;

		const model = resolveAdvisorModel(ctx, options.modelRef);
		if (!model) {
			if (!warnedMissingModel) {
				warnedMissingModel = true;
				options.onWarn?.(`oh-my-pi: advisor model "${options.modelRef}" is not available`);
			}
			return;
		}

		const context: AdvisorContext = {
			systemPrompt: ADVISOR_SYSTEM_PROMPT,
			messages: [{ role: "user", content: excerpt, timestamp: Date.now() }],
		};

		calls++;
		try {
			const reply = await completeWithRotation(ctx.modelRegistry, options.apiKeys, model, context, {
				maxTokens: ADVISOR_MAX_TOKENS,
			});
			const advice = reply.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n")
				.trim();
			if (!advice || advice === "OK") return;
			return {
				entries: [
					{
						type: "custom_message" as const,
						customType: "oh-my-pi-advisor",
						content: advice,
						display: true,
					},
				],
			};
		} catch (error) {
			options.onWarn?.(
				`oh-my-pi: advisor call failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		}
	});
}
