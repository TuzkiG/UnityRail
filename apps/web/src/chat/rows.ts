import {
	assistantToolCallsAreExecutable,
	type BackgroundCommandCompletionDetails,
	type ChatHandoffDetails,
	type ContinueInWorkspaceRequestDetails,
	completionDelivery,
	type GitDiffScope,
	type GitFileChange,
	type ReviewFixDetails,
	type SubagentCompletionDetails,
	type ThinkingLevel,
	type TurnChangeSet,
	type UserMessage,
} from "@thinkrail/contracts";
import { strArg } from "@thinkrail/extension-api/web";
import { projectRelativePath } from "../lib";
import { type AssistantFailure, assistantFailure } from "./assistantFailure";
import type { ChatMessageOrder } from "./chatPreferences";
import { pulledResult, resultKey } from "./pulledResults";
import { resolveProminence } from "./toolRegistry";
import type { ChatTurn, CompactionState, FailureRecovery, ToolResultState } from "./types";

// User-message collapse threshold (PlainUserTurn); also read by row height estimation.
export const LARGE_USER_MESSAGE = 500;

export interface ToolCallData {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	tool: ToolResultState | undefined;
	dead: boolean;
	streaming: boolean;
	/** The model call that requested this tool, so a group header can name every call inside it. */
	model?: string;
	thinkingLevel?: ThinkingLevel;
}

export type RoutineToolStep = { kind: "tool"; id: string } & ToolCallData;

export interface ThinkingStep {
	kind: "thinking";
	id: string;
	text: string;
	streaming: boolean;
	tools: RoutineToolStep[];
	/** The model call this block came from, so the header can name it (`provider/id`). */
	model?: string;
	thinkingLevel?: ThinkingLevel;
}

export type ActivityStep = RoutineToolStep | ThinkingStep;

export type ChatRow =
	| { kind: "user"; id: string; message: UserMessage; attachmentNames?: string[] }
	| { kind: "system"; id: string; text: string }
	| {
			kind: "error";
			id: string;
			text: string;
			failure?: AssistantFailure;
			recovery?: FailureRecovery;
	  }
	| ({ kind: "compaction"; id: string } & CompactionState)
	| {
			kind: "retry";
			id: string;
			source: "turn" | "summarization";
			attempt: number;
			maxAttempts: number;
			delayMs: number;
	  }
	| { kind: "markdown"; id: string; text: string; model?: string; thinkingLevel?: ThinkingLevel }
	| { kind: "backgroundCommandCompletion"; id: string; details: BackgroundCommandCompletionDetails }
	| { kind: "subagentCompletion"; id: string; details: SubagentCompletionDetails; text: string }
	| { kind: "reviewFix"; id: string; details: ReviewFixDetails; text: string }
	| { kind: "continuationRequest"; id: string; details: ContinueInWorkspaceRequestDetails }
	| { kind: "handoff"; id: string; details: ChatHandoffDetails }
	| ({ kind: "tool"; id: string } & ToolCallData)
	| {
			kind: "activity";
			id: string;
			steps: ActivityStep[];
			live: boolean;
	  }
	| { kind: "divider"; id: string; data: TurnDividerData };

export function rowsHaveToolCall(rows: readonly ChatRow[], toolCallId: string): boolean {
	return rows.some((row) => {
		if (row.kind === "tool") return row.toolCallId === toolCallId;
		if (row.kind !== "activity") return false;
		return row.steps.some((step) =>
			step.kind === "tool"
				? step.toolCallId === toolCallId
				: step.tools.some((tool) => tool.toolCallId === toolCallId),
		);
	});
}

export function projectRows(rows: ChatRow[], messageOrder: ChatMessageOrder): ChatRow[] {
	if (messageOrder === "oldest-first" || rows.length < 2) return rows;
	const groups: ChatRow[][] = [];
	let group: ChatRow[] = [];
	for (const row of rows) {
		if (row.kind === "user" && group.length > 0) {
			groups.push(group);
			group = [];
		}
		group.push(row);
	}
	if (group.length > 0) groups.push(group);

	const projected: ChatRow[] = [];
	for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
		const current = groups[groupIndex];
		if (!current) continue;
		for (let rowIndex = current.length - 1; rowIndex >= 0; rowIndex -= 1) {
			const row = current[rowIndex];
			if (row) projected.push(row);
		}
	}
	return projected;
}

function nestRoutineRun(steps: ActivityStep[]): ActivityStep[] {
	const nested: ActivityStep[] = [];
	let currentThinking: ThinkingStep | undefined;
	for (const step of steps) {
		if (step.kind === "thinking") {
			currentThinking = { ...step, tools: [] };
			nested.push(currentThinking);
		} else if (currentThinking) {
			currentThinking.tools.push(step);
		} else {
			nested.push(step);
		}
	}
	return nested;
}

export function opensRound(turn: ChatTurn): boolean {
	switch (turn.kind) {
		case "user":
		case "reviewFix":
		case "continuationRequest":
		case "handoff":
			return true;
		case "backgroundCommandCompletion":
		case "subagentCompletion":
			return completionDelivery(turn.details) !== "run";
		default:
			return false;
	}
}

function roundStartMs(turn: ChatTurn): number | null {
	if (!opensRound(turn)) return null;
	const at =
		turn.kind === "user" ? turn.message.timestamp : "timestamp" in turn ? turn.timestamp : null;
	return typeof at === "number" && Number.isFinite(at) ? at : null;
}

/** One assistant message is one model call: Auto may answer two consecutive calls on different models. */
function modelCall(message: Extract<ChatTurn, { kind: "assistant" }>["message"]): {
	model?: string;
	thinkingLevel?: ThinkingLevel;
} {
	if (!message.provider || !message.model) return {};
	return {
		model: `${message.provider}/${message.model}`,
		...(message.thinkingLevel ? { thinkingLevel: message.thinkingLevel } : {}),
	};
}

type AssistantTurn = Extract<ChatTurn, { kind: "assistant" }>;
type AssistantBlock = AssistantTurn["message"]["content"][number];
type ModelCall = ReturnType<typeof modelCall>;

type BlockDerivation =
	| { kind: "step"; step: ActivityStep }
	| { kind: "row"; row: ChatRow; addedKey: string | null }
	| { kind: "none" };

interface BlockCacheEntry {
	turnId: string;
	blockIndex: number;
	tool: ToolResultState | undefined;
	toolResultSeen: boolean;
	dead: boolean;
	streaming: boolean;
	model: string | undefined;
	thinkingLevel: ThinkingLevel | undefined;
	result: BlockDerivation;
}

const blockDerivations = new WeakMap<object, BlockCacheEntry>();

function deriveAssistantBlock(
	turn: AssistantTurn,
	block: AssistantBlock,
	blockIndex: number,
	dead: boolean,
	call: ModelCall,
	toolResults: Record<string, ToolResultState>,
	received: Set<string>,
): BlockDerivation {
	let tool: ToolResultState | undefined;
	let seen = false;
	let pulled: ReturnType<typeof pulledResult> | undefined;
	if (block.type === "toolCall") {
		tool = toolResults[block.id];
		pulled = pulledResult(block.name, block.arguments, tool);
		seen = pulled ? received.has(pulled.key) : false;
	}
	const cached = blockDerivations.get(block);
	if (
		cached &&
		cached.turnId === turn.id &&
		cached.blockIndex === blockIndex &&
		cached.tool === tool &&
		cached.toolResultSeen === seen &&
		cached.dead === dead &&
		cached.streaming === turn.streaming &&
		cached.model === call.model &&
		cached.thinkingLevel === call.thinkingLevel
	) {
		if (cached.result.kind === "row" && cached.result.addedKey !== null) {
			received.add(cached.result.addedKey);
		}
		return cached.result;
	}
	let result: BlockDerivation = { kind: "none" };
	if (block.type === "thinking") {
		if (block.thinking.trim().length > 0) {
			result = {
				kind: "step",
				step: {
					kind: "thinking",
					id: `${turn.id}:thinking:${blockIndex}`,
					text: block.thinking,
					streaming: turn.streaming,
					tools: [],
					...call,
				},
			};
		}
	} else if (block.type === "text") {
		if (block.text.trim().length > 0) {
			result = {
				kind: "row",
				row: { kind: "markdown", id: `${turn.id}:text:${blockIndex}`, text: block.text, ...call },
				addedKey: null,
			};
		}
	} else if (block.type === "toolCall") {
		const data: ToolCallData = {
			toolCallId: block.id,
			toolName: block.name,
			args: block.arguments,
			tool,
			dead,
			streaming: turn.streaming,
			...call,
		};
		if (pulled && !seen) {
			result = {
				kind: "row",
				row:
					pulled.kind === "subagentCompletion"
						? { kind: pulled.kind, id: block.id, details: pulled.details, text: pulled.text }
						: { kind: pulled.kind, id: block.id, details: pulled.details },
				addedKey: pulled.key,
			};
			received.add(pulled.key);
		} else if (resolveProminence(block.name).prominence === "primary") {
			result = { kind: "row", row: { kind: "tool", id: block.id, ...data }, addedKey: null };
		} else {
			result = { kind: "step", step: { kind: "tool", id: block.id, ...data } };
		}
	}
	blockDerivations.set(block, {
		turnId: turn.id,
		blockIndex,
		tool,
		toolResultSeen: seen,
		dead,
		streaming: turn.streaming,
		model: call.model,
		thinkingLevel: call.thinkingLevel,
		result,
	});
	return result;
}

interface ActivityCacheEntry {
	steps: ActivityStep[];
	live: boolean;
	row: ChatRow;
}

const activityRows = new WeakMap<ActivityStep, ActivityCacheEntry>();

function sameSteps(left: readonly ActivityStep[], right: readonly ActivityStep[]): boolean {
	if (left.length !== right.length) return false;
	for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
	return true;
}

function activityRow(steps: ActivityStep[], live: boolean): ChatRow {
	const first = steps[0];
	if (!first) throw new Error("activityRow requires a step");
	const cached = activityRows.get(first);
	if (cached && cached.live === live && sameSteps(cached.steps, steps)) return cached.row;
	const row: ChatRow = {
		kind: "activity",
		id: `activity:${first.id}`,
		steps: nestRoutineRun(steps),
		live,
	};
	activityRows.set(first, { steps, live, row });
	return row;
}

const singleTurnRows = new WeakMap<ChatTurn, ChatRow | null>();

function singleTurnRow(turn: ChatTurn): ChatRow | null {
	if (singleTurnRows.has(turn)) return singleTurnRows.get(turn) ?? null;
	let row: ChatRow | null = null;
	switch (turn.kind) {
		case "user":
			row = {
				kind: "user",
				id: turn.id,
				message: turn.message,
				...(turn.attachmentNames ? { attachmentNames: turn.attachmentNames } : {}),
			};
			break;
		case "system":
			if (turn.text !== undefined) row = { kind: "system", id: turn.id, text: turn.text };
			break;
		case "error":
			row = {
				kind: "error",
				id: turn.id,
				text: turn.text,
				...(turn.failure ? { failure: turn.failure } : {}),
				...(turn.recovery ? { recovery: turn.recovery } : {}),
			};
			break;
		case "compaction":
			row = turn;
			break;
		case "retry":
			row = {
				kind: "retry",
				id: turn.id,
				source: turn.source,
				attempt: turn.attempt,
				maxAttempts: turn.maxAttempts,
				delayMs: turn.delayMs,
			};
			break;
		case "backgroundCommandCompletion":
			row = { kind: "backgroundCommandCompletion", id: turn.id, details: turn.details };
			break;
		case "subagentCompletion":
			row = { kind: "subagentCompletion", id: turn.id, details: turn.details, text: turn.text };
			break;
		case "reviewFix":
			row = { kind: "reviewFix", id: turn.id, details: turn.details, text: turn.text };
			break;
		case "continuationRequest":
			row = { kind: "continuationRequest", id: turn.id, details: turn.details };
			break;
		case "handoff":
			row = { kind: "handoff", id: turn.id, details: turn.details };
			break;
	}
	singleTurnRows.set(turn, row);
	return row;
}

export function deriveRows(
	turns: ChatTurn[],
	toolResults: Record<string, ToolResultState>,
	isStreaming: boolean,
	isSpec?: (path: string) => boolean,
	agentTurns: readonly TurnChangeSet[] = [],
	workspaceRoot?: string,
): ChatRow[] {
	const rows: ChatRow[] = [];
	let run: ActivityStep[] = [];
	const received = new Set<string>();
	for (const turn of turns) {
		const key = resultKey(turn);
		if (key) received.add(key);
	}

	const flushRun = (live = false) => {
		if (run.length === 0) return;
		rows.push(activityRow(run, live));
		run = [];
	};

	for (let i = 0; i < turns.length; i++) {
		const turn = turns[i];
		if (!turn) continue;
		if (turn.kind === "assistant") {
			const { message } = turn;
			const dead = !assistantToolCallsAreExecutable(message.stopReason);
			const call = modelCall(message);
			for (let b = 0; b < message.content.length; b++) {
				const block = message.content[b];
				if (!block) continue;
				const derivation = deriveAssistantBlock(turn, block, b, dead, call, toolResults, received);
				if (derivation.kind === "step") run.push(derivation.step);
				else if (derivation.kind === "row") {
					flushRun();
					rows.push(derivation.row);
				}
			}
		} else {
			flushRun();
			const row = singleTurnRow(turn);
			if (row) rows.push(row);
		}
		const next = turns[i + 1];
		const roundEnded = !opensRound(turn) && (next ? opensRound(next) : !isStreaming);
		if (roundEnded) {
			flushRun();
			const data = turnDivider(turns, i, isSpec, agentTurns, workspaceRoot);
			if (data) rows.push({ kind: "divider", id: `${turn.id}:divider`, data });
		}
	}
	flushRun(isStreaming);
	return rows;
}

export interface TurnReceipt {
	scope: Extract<GitDiffScope, { kind: "turn" }>;
	changes: GitFileChange[];
}

export interface TurnDividerData {
	outcome: "done" | "stopped" | "error" | null;
	elapsedMs: number | null;
	toolCount: number;
	specs: string[];
	changedFiles: string[];
	receipt: TurnReceipt | null;
}

export function matchTurnReceipt(
	agentTurns: readonly TurnChangeSet[],
	startMs: number | null,
	nextStartMs: number | null,
): TurnReceipt | null {
	if (startMs === null) return null;
	const runs = agentTurns.filter(
		(turn) => turn.startedAt >= startMs && (nextStartMs === null || turn.startedAt < nextStartMs),
	);
	const first = runs[0];
	const last = runs.at(-1);
	if (!first || !last) return null;
	const byPath = new Map<string, GitFileChange>();
	const nested = new Map<string, NonNullable<TurnChangeSet["nestedTrees"]>[number]>();
	for (const run of runs) {
		for (const change of run.changes) byPath.set(change.path, change);
		for (const pair of run.nestedTrees ?? []) {
			const held = nested.get(pair.repo);
			if (held) held.headTree = pair.headTree;
			else nested.set(pair.repo, { ...pair });
		}
	}
	return {
		scope: {
			kind: "turn",
			id: first === last ? last.id : `${first.id}..${last.id}`,
			baseTree: first.baseTree,
			headTree: last.headTree,
			startedAt: first.startedAt,
			...(nested.size > 0 ? { nestedTrees: [...nested.values()] } : {}),
		},
		changes: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
	};
}

const SPEC_WRITER_TOOL = "spec_create";

const FILE_WRITER_TOOLS = new Set(["write", "edit"]);

export function turnDivider(
	turns: ChatTurn[],
	endIndex: number,
	isSpec: (path: string) => boolean = () => false,
	agentTurns: readonly TurnChangeSet[] = [],
	workspaceRoot?: string,
): TurnDividerData | null {
	let openerIdx = -1;
	for (let i = endIndex; i >= 0; i--) {
		const turn = turns[i];
		if (turn && opensRound(turn)) {
			openerIdx = i;
			break;
		}
	}
	const opener = turns[openerIdx];
	if (!opener) return null;

	let toolCount = 0;
	const written = new Map<string, boolean>();
	let endMs: number | null = null;
	for (let i = openerIdx + 1; i <= endIndex; i++) {
		const turn = turns[i];
		if (turn?.kind === "assistant") {
			if (turn.message.timestamp) endMs = turn.message.timestamp;
			for (const block of turn.message.content) {
				if (block.type !== "toolCall") continue;
				toolCount++;
				const specWrite = block.name === SPEC_WRITER_TOOL;
				if (!specWrite && !FILE_WRITER_TOOLS.has(block.name)) continue;
				const reportedPath = strArg(block.arguments, "path");
				if (!reportedPath) continue;
				const path = projectRelativePath(reportedPath, workspaceRoot);
				if (specWrite || isSpec(path)) written.set(path, true);
				else if (!written.has(path)) written.set(path, false);
			}
		} else if (turn?.kind === "system" && turn.endedAt != null) {
			endMs = turn.endedAt;
		}
	}

	const startMs = roundStartMs(opener);
	const elapsedMs = startMs != null && endMs != null ? endMs - startMs : null;

	const next = turns[endIndex + 1];
	const nextStartMs = next && opensRound(next) ? roundStartMs(next) : null;
	const receipt = matchTurnReceipt(agentTurns, startMs, nextStartMs);
	const specs: string[] = [];
	const changedFiles: string[] = [];
	for (const [path, isSpecPath] of written) (isSpecPath ? specs : changedFiles).push(path);
	if (receipt) {
		changedFiles.length = 0;
		for (const change of receipt.changes) {
			if (written.get(change.path) === true || isSpec(change.path)) {
				if (!specs.includes(change.path)) specs.push(change.path);
			} else changedFiles.push(change.path);
		}
	}
	return {
		outcome: roundOutcome(turns, openerIdx, endIndex),
		elapsedMs,
		toolCount,
		specs,
		changedFiles,
		receipt,
	};
}

function roundOutcome(
	turns: ChatTurn[],
	openerIdx: number,
	endIndex: number,
): TurnDividerData["outcome"] {
	let closer: "done" | "error" | null = null;
	for (let i = endIndex; i > openerIdx; i--) {
		const turn = turns[i];
		if (turn?.kind === "assistant") {
			const { message } = turn;
			if (assistantFailure(message)) return "error";
			if (message.stopReason === "aborted") return "stopped";
			return closer ?? (message.stopReason === "stop" ? "done" : null);
		}
		if (closer) continue;
		if (turn?.kind === "system" && turn.text === undefined) closer = "done";
		else if (turn?.kind === "error" && turn.failure) closer = "error";
	}
	return closer;
}

export function rowIndexForTurn(rows: ChatRow[], turnId: string): number {
	return rows.findIndex((r) => r.id === turnId || r.id.startsWith(`${turnId}:text:`));
}

function valueEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!valueEqual(a[i], b[i])) return false;
		return true;
	}
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	for (const key of aKeys) {
		if (!Object.hasOwn(b, key)) return false;
		if (!valueEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
			return false;
	}
	return true;
}

/**
 * Reuse the previous row object for every row whose rendered content is unchanged, so a memoized
 * `ChatTurnView` bails out for rows that did not change across a streaming delta. Pure: it never mutates
 * its inputs and preserves the order/shape of `next`; it only swaps unchanged entries for their prior
 * reference. Row ids are stable across re-derivation (pi appends, never reorders), so matching by id and
 * then value-comparing the rendered fields is sufficient.
 */
export function stabilizeRows(previous: ChatRow[], next: ChatRow[]): ChatRow[] {
	if (previous.length === 0) return next;
	const byId = new Map<string, ChatRow>();
	for (const row of previous) byId.set(row.id, row);
	let changed = false;
	const result = next.map((row) => {
		const prior = byId.get(row.id);
		if (prior && prior !== row && valueEqual(prior, row)) {
			changed = true;
			return prior;
		}
		return row;
	});
	return changed ? result : next;
}
