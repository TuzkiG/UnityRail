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

const AUTO_THINKING_LEVELS: readonly ModelThinkingLevel[] = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

/** Ordering used when a model cannot run the derived level. */
const LEVEL_RANK: Record<ModelThinkingLevel, number> = {
	off: 0,
	minimal: 1,
	low: 2,
	medium: 3,
	high: 4,
	xhigh: 5,
	max: 6,
};

/** Automatic reasoning: planning reasons harder, execution stays cheap. */
const AUTO_PHASE_LEVEL: Record<AutoPhase, Record<AutoDifficulty, ModelThinkingLevel>> = {
	plan: { easy: "medium", hard: "high" },
	execute: { easy: "low", hard: "medium" },
};

/** Tools whose successful result means the plan is being carried out. */
const EXECUTION_TOOLS: ReadonlySet<string> = new Set(["edit", "write"]);

/** A successful Git write is execution even though it never touches edit/write. */
const GIT_WRITE_COMMAND =
	/\bgit\b[^\n;&|]*?\s(?:add|am|apply|checkout|cherry-pick|clean|commit|merge|mv|push|rebase|reset|restore|revert|rm|stash|switch|tag|update-ref)\b/iu;

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
	/```|[\w./-]+\.(?:[cm]?[jt]sx?|json|md|py|go|rs|java|kt|cs|unity|ya?ml|toml|css|html|sh|ps1)\b|\b(?:error|exception|traceback|stack trace|conflict(?:s|ed|ing)?|fail(?:s|ed|ures?)?|报错|异常|冲突|失败)\b/iu;

/** A short, mechanical Git request is execution; conflict/failure text stays hard above. */
const GIT_MECHANIC =
	/\bgit\b|(?:提交|推送|合并|合成|压缩|变基|回滚)[^\n]{0,16}(?:分支|提交|仓库|代码|改动|main|master|git)|(?:分支|提交|仓库|代码|改动|main|master)[^\n]{0,16}(?:提交|推送|合并|合成|压缩|变基|回滚)|(?:rebase|merge|squash|cherry-pick)[^\n]{0,20}(?:origin\/|main|master|branch|commit)/iu;

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
	/** The user's Auto settings; every field unset keeps the automatic pick. */
	preferences?: AutoModelPreferences;
}

/** What Settings pins for an Auto chat, read per route so a change applies to the next turn. */
export interface AutoModelPreferences {
	/** The plan phase's model; unset keeps the flagship pick. */
	plan?: ModelRef;
	/** The execution phase's model; unset keeps the cheap pick. */
	execute?: ModelRef;
	/** Overrides the chat's own thinking level for both phases. */
	effort?: ModelThinkingLevel;
	/** `automatic` derives the level per phase/difficulty; `chat` follows the chat. */
	reasoning?: "automatic" | "chat";
}

let preferencesSource: () => AutoModelPreferences = () => ({});

/** The host owns the settings read; Auto stays a pure router and never imports settings itself. */
export function setAutoModelPreferencesSource(source: () => AutoModelPreferences): void {
	preferencesSource = source;
}

export type AutoRoute = ModelRoute<AutoModelState>;

/** Whether execution started since the last user message — the hand-off from plan to execute. */
function executedPlan(messages: readonly Message[]): boolean {
	const lastUser = messages.findLastIndex((message) => message.role === "user");
	const after = messages.slice(lastUser + 1);
	const bashCommands = new Map<string, string>();
	for (const message of after) {
		if (message.role !== "assistant") continue;
		for (const block of message.content) {
			if (block.type !== "toolCall" || block.name !== "bash") continue;
			const command = block.arguments.command;
			if (typeof command === "string") bashCommands.set(block.id, command);
		}
	}
	return after.some((message) => {
		if (message.role !== "toolResult" || message.isError) return false;
		if (EXECUTION_TOOLS.has(message.toolName)) return true;
		const command = bashCommands.get(message.toolCallId);
		return !!command && GIT_WRITE_COMMAND.test(command);
	});
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
	if (HARD_SIGNAL.test(text)) return "hard";
	if (GIT_MECHANIC.test(text)) return "easy";
	if (CHANGE_VERB.test(text)) return "hard";
	const asks = text.endsWith("?") || text.endsWith("？") || QUESTION_START.test(text);
	return asks ? "easy" : "hard";
}

function supportedLevels(model: Model<Api>): readonly ModelThinkingLevel[] {
	const declared = (model as { thinkingLevels?: readonly ModelThinkingLevel[] }).thinkingLevels;
	return declared && declared.length > 0 ? declared : AUTO_THINKING_LEVELS;
}

/** The derived level, clamped down to what the chosen model can actually run. */
export function automaticThinkingLevel(
	model: Model<Api>,
	phase: AutoPhase,
	difficulty: AutoDifficulty,
): ModelThinkingLevel {
	const desired = AUTO_PHASE_LEVEL[phase][difficulty];
	const levels = supportedLevels(model);
	if (levels.includes(desired)) return desired;
	const sorted = [...levels].sort((left, right) => LEVEL_RANK[left] - LEVEL_RANK[right]);
	const notAbove = sorted.filter((level) => LEVEL_RANK[level] <= LEVEL_RANK[desired]);
	return notAbove.at(-1) ?? sorted[0] ?? desired;
}

export function routeAutoModel(input: AutoRouteInput): AutoRoute {
	const available = input.available.filter((model) => !isVirtualModel(model));
	const preferred = input.preferences ?? {};
	const plan = firstAvailable(
		available,
		refs(preferred.plan, input.state?.plan, input.previous, preferredDefaultModel(available)),
	);
	if (!plan) throw new Error("Auto model: no available model to route to");
	const execute =
		firstAvailable(
			available,
			refs(preferred.execute, input.state?.execute, cheapModel(available), plan),
		) ?? plan;
	const state = input.state;
	const difficulty = assessDifficulty(input.messages);
	const phase: AutoPhase =
		input.reason === "direct"
			? "execute"
			: input.reason === "user"
				? difficulty === "easy"
					? "execute"
					: "plan"
				: state?.phase === "plan" && executedPlan(input.messages)
					? "execute"
					: (state?.phase ?? "plan");
	const model = phase === "plan" ? plan : execute;
	const thinkingLevel =
		preferred.effort ??
		(preferred.reasoning === "automatic"
			? automaticThinkingLevel(model, phase, difficulty)
			: input.thinkingLevel);

	if (input.reason === "direct") return { model, thinkingLevel };

	const sameSelection = state && state.phase === phase;
	return {
		model,
		thinkingLevel,
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
				preferences: preferencesSource(),
				...(request.previous ? { previous: request.previous.model } : {}),
				...(request.state ? { state: request.state } : {}),
			}),
	});
}
