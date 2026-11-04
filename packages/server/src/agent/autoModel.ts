import type { Api, Message, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type {
	ModelRoute,
	ModelRouteReason,
	ModelRouteRequest,
	VirtualModelDefinition,
} from "@earendil-works/pi-coding-agent";
import { cheapModel, isVirtualModel, preferredDefaultModel } from "./modelDefaults";

export const AUTO_MODEL_PROVIDER = "thinkrail";
export const AUTO_MODEL_ID = "auto";
export const AUTO_MODEL_NAME = "Auto";

const AUTO_THINKING_LEVELS: readonly ModelThinkingLevel[] = ["low", "medium", "high"];

/** Tools whose successful result means the plan is being carried out. */
const EXECUTION_TOOLS: ReadonlySet<string> = new Set(["edit", "write"]);

/** An easy turn never reaches the flagship model; its shape must say so positively. */
const EASY_MAX_CHARS = 280;
const EASY_MAX_LINES = 6;

const QUESTION_START =
	/^(?:who|what|when|where|why|which|whose|how|is|are|was|were|does|do|did|can|could|should|would|will|has|have|explain|describe|tell|解释|说明|什么|怎么|为何|为什么|如何|哪|谁|是否|能否|可以|吗)/iu;

/** A request that asks for work instead of an answer is hard, however short it is. */
const CHANGE_VERB =
	/\b(?:add|implement|refactor|fix|migrate|rename|create|delete|remove|build|write|update|change|rewrite|port|extract|move|split|merge|bump|upgrade|install|debug|实现|重构|修复|添加|删除|修改|迁移|创建|升级|改造|编写|补充|调整|接入|集成|支持|替换|整理)/iu;

/** Paths, code blocks and failure text mean the question is about specific work. */
const HARD_SIGNAL =
	/```|[\w./-]+\.(?:[cm]?[jt]sx?|json|md|py|go|rs|java|kt|cs|unity|ya?ml|toml|css|html|sh|ps1)\b|\b(?:error|exception|traceback|stack trace|报错|异常)\b/iu;

export type AutoPhase = "plan" | "execute";

/** How demanding the user's latest message reads; the plan phase is not entered for `easy`. */
export type AutoDifficulty = "easy" | "hard";

export interface AutoModelState {
	phase: AutoPhase;
	/** Physical model chosen for the plan; re-derived when it leaves the catalog. */
	plan: ModelRef;
	execute: ModelRef;
}

export interface ModelRef {
	provider: string;
	id: string;
}

function modelRef(model: Model<Api>): ModelRef {
	return { provider: model.provider, id: model.id };
}

function sameRef(model: ModelRef | Model<Api> | undefined, ref: ModelRef): boolean {
	return !!model && model.provider === ref.provider && model.id === ref.id;
}

/** The first candidate still in the catalog, so a logged-out provider re-derives instead of failing. */
function firstAvailable(
	available: readonly Model<Api>[],
	candidates: readonly ModelRef[],
): Model<Api> | undefined {
	for (const candidate of candidates) {
		const match = available.find((model) => sameRef(model, candidate));
		if (match) return match;
	}
	return undefined;
}

function refs(...candidates: readonly (Model<Api> | ModelRef | undefined)[]): ModelRef[] {
	const resolved: ModelRef[] = [];
	for (const candidate of candidates) {
		if (candidate) resolved.push({ provider: candidate.provider, id: candidate.id });
	}
	return resolved;
}

export interface AutoRouteInput {
	reason: ModelRouteReason;
	thinkingLevel: ModelThinkingLevel;
	available: readonly Model<Api>[];
	previous?: Model<Api>;
	state?: AutoModelState;
	messages: readonly Message[];
}

export type AutoRoute = ModelRoute<AutoModelState>;

/** Whether an edit succeeded since the last user message — the hand-off from plan to execute. */
function executedPlan(messages: readonly Message[]): boolean {
	const lastUser = messages.findLastIndex((message) => message.role === "user");
	return messages
		.slice(lastUser + 1)
		.some(
			(message) =>
				message.role === "toolResult" && EXECUTION_TOOLS.has(message.toolName) && !message.isError,
		);
}

function latestUserText(messages: readonly Message[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "user") continue;
		if (typeof message.content === "string") return message.content;
		return message.content
			.flatMap((block) => (block.type === "text" ? [block.text] : []))
			.join("\n");
	}
	return "";
}

/** Easy needs positive evidence; every other shape keeps the flagship model. */
export function assessDifficulty(messages: readonly Message[]): AutoDifficulty {
	const text = latestUserText(messages).trim();
	if (!text) return "hard";
	if (text.length > EASY_MAX_CHARS || text.split("\n").length > EASY_MAX_LINES) return "hard";
	if (CHANGE_VERB.test(text) || HARD_SIGNAL.test(text)) return "hard";
	const asks = text.endsWith("?") || text.endsWith("？") || QUESTION_START.test(text);
	return asks ? "easy" : "hard";
}

export function routeAutoModel(input: AutoRouteInput): AutoRoute {
	const available = input.available.filter((model) => !isVirtualModel(model));
	const plan = firstAvailable(
		available,
		refs(input.state?.plan, input.previous, preferredDefaultModel(available)),
	);
	if (!plan) throw new Error("Auto model: no available model to route to");
	const execute =
		firstAvailable(available, refs(input.state?.execute, cheapModel(available), plan)) ?? plan;

	if (input.reason === "direct") return { model: execute, thinkingLevel: input.thinkingLevel };

	const state = input.state;
	const phase: AutoPhase =
		input.reason === "user"
			? assessDifficulty(input.messages) === "easy"
				? "execute"
				: "plan"
			: state?.phase === "plan" && executedPlan(input.messages)
				? "execute"
				: (state?.phase ?? "plan");
	const model = phase === "plan" ? plan : execute;
	const sameSelection = state && state.phase === phase;
	return {
		model,
		thinkingLevel: input.thinkingLevel,
		...(sameSelection
			? {}
			: { state: { phase, plan: modelRef(plan), execute: modelRef(execute) } }),
	};
}

export type AutoModelRuntime = {
	registerVirtualModel(definition: VirtualModelDefinition<AutoModelState>): void;
};

/** Register the `Auto` model on one runtime generation; every request then routes per phase. */
export function registerAutoModel(
	runtime: AutoModelRuntime,
	available: () => readonly Model<Api>[],
): void {
	runtime.registerVirtualModel({
		provider: AUTO_MODEL_PROVIDER,
		id: AUTO_MODEL_ID,
		name: AUTO_MODEL_NAME,
		thinkingLevels: AUTO_THINKING_LEVELS,
		route: (request: ModelRouteRequest<AutoModelState>) =>
			routeAutoModel({
				reason: request.reason,
				thinkingLevel: request.thinkingLevel,
				available: available(),
				messages: request.messages,
				...(request.previous ? { previous: request.previous.model } : {}),
				...(request.state ? { state: request.state } : {}),
			}),
	});
}
