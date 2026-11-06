import { RiArrowGoBackLine as Reset, RiShieldCheckLine as Shield } from "@remixicon/react";
import {
	SESSION_COLLABORATION_CYCLE,
	type SessionApproval,
	type SessionCollaboration,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";

export const COLLABORATION_LABEL_KEY: Record<SessionCollaboration, MessageKey> = {
	default: "chat.policy.collaboration.default",
	ask: "chat.policy.collaboration.ask",
	plan: "chat.policy.collaboration.plan",
};

export const APPROVAL_LABEL_KEY: Record<SessionApproval, MessageKey> = {
	request: "chat.policy.approval.request",
	"full-auto": "chat.policy.approval.fullAuto",
};

export const COLLABORATION_MEANING_KEY: Record<SessionCollaboration, MessageKey> = {
	default: "chat.policy.collaboration.defaultMeaning",
	ask: "chat.policy.collaboration.askMeaning",
	plan: "chat.policy.collaboration.planMeaning",
};

export const APPROVAL_MEANING_KEY: Record<SessionApproval, MessageKey> = {
	request: "chat.policy.approval.requestMeaning",
	"full-auto": "chat.policy.approval.fullAutoMeaning",
};

/** Shift+Tab and a click walk the same order, so the chord never surprises. */
export function nextCollaboration(current: SessionCollaboration): SessionCollaboration {
	const index = SESSION_COLLABORATION_CYCLE.indexOf(current);
	return SESSION_COLLABORATION_CYCLE[(index + 1) % SESSION_COLLABORATION_CYCLE.length] ?? "default";
}

export interface SessionPolicyPickerProps {
	collaboration: SessionCollaboration;
	approval: SessionApproval;
	onCycleCollaboration: () => void;
	onSelectApproval: (approval: SessionApproval) => void;
	className?: string;
}

/**
 * The two policy knobs the host enforces, side by side: what the agent may do (collaboration) and
 * whether it asks first (approval). Both are session-scoped and reset when the chat is reopened.
 */
export function SessionPolicyPicker({
	collaboration,
	approval,
	onCycleCollaboration,
	onSelectApproval,
	className,
}: SessionPolicyPickerProps) {
	const t = useT();
	const readOnly = collaboration !== "default";
	return (
		<div className={cn("flex min-w-0 items-center gap-2", className)}>
			<IconTooltip
				label={`${t(COLLABORATION_MEANING_KEY[collaboration])}\n${t("chat.policy.collaboration.hint")}`}
			>
				<Button
					type="button"
					variant="ghost"
					size="s"
					data-testid="composer-collaboration"
					data-collaboration={collaboration}
					aria-label={t(COLLABORATION_LABEL_KEY[collaboration])}
					className={cn("gap-2 px-4", readOnly && "text-feedback-warning")}
					onClick={onCycleCollaboration}
				>
					<Shield className="size-4 shrink-0" aria-hidden />
					<span className="truncate">{t(COLLABORATION_LABEL_KEY[collaboration])}</span>
				</Button>
			</IconTooltip>
			<IconTooltip label={t(APPROVAL_MEANING_KEY[approval])}>
				<Button
					type="button"
					variant="ghost"
					size="s"
					data-testid="composer-approval"
					data-approval={approval}
					aria-label={t(APPROVAL_LABEL_KEY[approval])}
					className="gap-2 px-4"
					onClick={() => onSelectApproval(approval === "request" ? "full-auto" : "request")}
				>
					<Reset className="size-4 shrink-0" aria-hidden />
					<span className="truncate">{t(APPROVAL_LABEL_KEY[approval])}</span>
				</Button>
			</IconTooltip>
		</div>
	);
}
