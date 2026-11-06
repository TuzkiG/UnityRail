import type {
	ExtensionAPI,
	ExtensionContext,
	InlineExtension,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import type { SessionCollaboration, SessionPolicy } from "@thinkrail/contracts";
import type { AskForToolCall } from "./mcp/sessionHost.ts";

/**
 * Tools that change the workspace or run project code. `ask` and `plan` are read-only, so a call is
 * refused before it runs — including delegation, which would otherwise move the work to a session that
 * does not inherit this policy.
 */
export const READ_ONLY_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
	"edit",
	"write",
	"bash",
	"background_command",
	"Agent",
	"unity_edit_scene",
	"unity_project_action",
]);

/** Tools that execute arbitrary commands, so `request` approval asks before each one. */
export const APPROVAL_TOOLS: ReadonlySet<string> = new Set(["bash"]);

export const POLICY_CONFIRM_DENY = "Deny";
export const POLICY_CONFIRM_ONCE = "Allow once";
export const POLICY_CONFIRM_CHAT = "Allow in this chat";
const CONFIRM_OPTIONS = [POLICY_CONFIRM_DENY, POLICY_CONFIRM_ONCE, POLICY_CONFIRM_CHAT];

function readOnlyReason(mode: Exclude<SessionCollaboration, "default">): string {
	return mode === "ask"
		? "This chat is in Ask mode: it reads and answers, and does not modify files or run commands. Ask the user to switch the collaboration mode to Default before making changes."
		: "This chat is in Plan mode: explore and agree on a plan before changing anything. Ask the user to switch the collaboration mode to Default once the plan is approved.";
}

function describeCall(event: ToolCallEvent): string {
	const input: Record<string, unknown> =
		event.input && typeof event.input === "object" ? event.input : {};
	const command = typeof input.command === "string" ? input.command.trim() : "";
	const head = command.length > 160 ? `${command.slice(0, 160)}…` : command;
	return head
		? `Run this command?\n${head}`
		: "Run this shell command? It can change files and the machine.";
}

export interface SessionPolicyGuardOptions {
	/** Read on every call, so a mode change applies to the next tool call without rebinding. */
	policy: () => SessionPolicy;
	askForToolCall: AskForToolCall;
}

/**
 * Enforces the two policy knobs on `tool_call`: the collaboration mode decides whether a mutating tool
 * may run at all, the approval policy decides whether the user is asked first. Both narrow what the
 * agent can do, and neither can widen what pi would allow.
 */
export function createSessionPolicyExtension({
	policy,
	askForToolCall,
}: SessionPolicyGuardOptions): InlineExtension {
	const allowedInChat = new Set<string>();

	const enforce = async (
		event: ToolCallEvent,
		ctx: ExtensionContext,
	): Promise<ToolCallEventResult | undefined> => {
		const current = policy();
		if (current.collaboration !== "default" && READ_ONLY_BLOCKED_TOOLS.has(event.toolName)) {
			return { block: true, reason: readOnlyReason(current.collaboration) };
		}
		if (current.approval !== "request" || !APPROVAL_TOOLS.has(event.toolName)) return undefined;
		if (allowedInChat.has(event.toolName)) return undefined;
		if (!ctx.hasUI) {
			return {
				block: true,
				reason: "This command needs the user's confirmation, and no UI is attached.",
			};
		}
		const answer = await askForToolCall(
			event.toolCallId,
			event.input,
			describeCall(event),
			CONFIRM_OPTIONS,
			ctx.signal,
		);
		if (answer === POLICY_CONFIRM_ONCE) return undefined;
		if (answer === POLICY_CONFIRM_CHAT) {
			allowedInChat.add(event.toolName);
			return undefined;
		}
		if (answer === POLICY_CONFIRM_DENY)
			return { block: true, reason: "The user denied this command." };
		return {
			block: true,
			reason: ctx.signal?.aborted
				? "The command was cancelled before the user confirmed it."
				: "The user did not confirm this command: they dismissed it or replied in the chat instead.",
		};
	};

	return {
		name: "session-policy",
		factory: (pi: ExtensionAPI) => {
			pi.on("tool_call", (event, ctx) => enforce(event, ctx));
		},
	};
}
