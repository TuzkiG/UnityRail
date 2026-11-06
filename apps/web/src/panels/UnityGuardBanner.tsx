import {
	RiAlertLine,
	RiArrowDownSLine,
	RiArrowRightSLine,
	RiShieldCheckLine,
} from "@remixicon/react";
import type { UnityGuardCode, UnityGuardFinding, UnityGuardReport } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useEffect, useMemo, useState } from "react";
import { getTransport } from "../transport";
import { startChatInTab } from "./openChat";

const GUARD_LABEL: Record<UnityGuardCode, MessageKey> = {
	MISSING_META: "changes.guard.code.MISSING_META",
	ORPHAN_META: "changes.guard.code.ORPHAN_META",
	DUPLICATE_GUID: "changes.guard.code.DUPLICATE_GUID",
	LARGE_ASSET: "changes.guard.code.LARGE_ASSET",
	MERGE_DRIVER_MISSING: "changes.guard.code.MERGE_DRIVER_MISSING",
	IGNORE_MISSING: "changes.guard.code.IGNORE_MISSING",
};

function severityOf(finding: UnityGuardFinding): "error" | "warning" {
	return finding.severity;
}

/**
 * Unity asset guard over the current change set: an asset without its `.meta`, a duplicated GUID, a
 * large binary that never reached LFS, and a repository that would merge scenes as text. It stays a
 * banner (never a blocking modal) and hands the fix to the agent as a draft the user can edit.
 */
export function UnityGuardBanner({
	workspaceId,
	changeCount,
	onOpen,
}: {
	workspaceId: string;
	changeCount: number;
	onOpen: (path: string) => void;
}) {
	const t = useT();
	const [report, setReport] = useState<UnityGuardReport | null>(null);
	const [expanded, setExpanded] = useState(false);

	useEffect(() => {
		if (changeCount === 0) {
			setReport(null);
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			void getTransport()
				.request("unity.assetGuard", { workspaceId })
				.then((next) => {
					if (!cancelled) setReport(next);
				})
				.catch(() => {
					if (!cancelled) setReport(null);
				});
		}, 400);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [changeCount, workspaceId]);

	const findings = report?.findings ?? [];
	const counts = useMemo(() => {
		let errors = 0;
		let warnings = 0;
		for (const finding of findings) {
			if (severityOf(finding) === "error") errors += 1;
			else warnings += 1;
		}
		return { errors, warnings };
	}, [findings]);

	if (findings.length === 0) return null;
	const Chevron = expanded ? RiArrowDownSLine : RiArrowRightSLine;

	const fixWithAgent = () => {
		const lines = findings.map(
			(finding) =>
				`- ${t(GUARD_LABEL[finding.code])}${finding.path ? `: ${finding.path}` : ""}${finding.detail ? ` (${finding.detail})` : ""}`,
		);
		void startChatInTab(workspaceId, {
			draft: `${t("changes.guard.agentIntro")}\n\n${lines.join("\n")}`,
		});
	};

	return (
		<div
			data-testid="unity-guard"
			data-errors={counts.errors}
			data-warnings={counts.warnings}
			className="shrink-0 border-border-default border-b bg-container-elevated-bg"
		>
			<div className="flex items-center gap-8 px-8 py-4">
				{counts.errors > 0 ? (
					<RiAlertLine className="size-14 shrink-0 text-feedback-error" aria-hidden />
				) : (
					<RiShieldCheckLine className="size-14 shrink-0 text-feedback-warning" aria-hidden />
				)}
				<button
					type="button"
					data-testid="unity-guard-toggle"
					aria-expanded={expanded}
					onClick={() => setExpanded((current) => !current)}
					className="flex min-w-0 flex-1 items-center gap-4 text-left"
				>
					<Chevron className="size-12 shrink-0 text-text-muted" aria-hidden />
					<span className="truncate text-text-default tr-text-metadata">
						{t("changes.guard.summary", {
							errors: counts.errors,
							warnings: counts.warnings,
						})}
					</span>
				</button>
				<Button size="s" variant="ghost" data-testid="unity-guard-fix" onClick={fixWithAgent}>
					{t("changes.guard.fix")}
				</Button>
			</div>
			{expanded ? (
				<ul className="flex flex-col pb-4">
					{findings.map((finding) => (
						<li
							key={`${finding.code}:${finding.path ?? ""}:${finding.detail ?? ""}`}
							data-testid="unity-guard-finding"
							data-code={finding.code}
							className="flex items-center gap-8 px-12 py-2"
						>
							<span
								className={
									severityOf(finding) === "error"
										? "size-8 shrink-0 rounded-sm bg-feedback-error"
										: "size-8 shrink-0 rounded-sm bg-feedback-warning"
								}
								aria-hidden
							/>
							<span className="shrink-0 text-text-default tr-text-metadata">
								{t(GUARD_LABEL[finding.code])}
							</span>
							{finding.path ? (
								<button
									type="button"
									onClick={() => onOpen(finding.path ?? "")}
									className="min-w-0 truncate text-left text-text-subtle tr-text-metadata hover:text-text-default"
									title={finding.path}
								>
									{finding.path}
								</button>
							) : null}
							{finding.detail ? (
								<span className="ml-auto shrink-0 text-text-subtle tr-text-metadata">
									{finding.detail}
								</span>
							) : null}
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
