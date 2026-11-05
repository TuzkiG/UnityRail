import type { GitFileChange } from "@thinkrail/contracts";
import { useScrollViewState } from "@thinkrail/resource-renderers";
import { useCallback, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { firstClickOnly } from "../lib";
import { selectFilesTreeView, useAppStore } from "../store";
import { ChangeRowActions } from "./ChangeRowActions";
import { groupChangesByRepo, splitPath, statusNameClass } from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";
import { NestedRepoTag } from "./NestedRepoTag";
import { ViewedMark } from "./ViewedMark";

const SAVE_DELAY_MS = 200;

type ChangedRow =
	| { kind: "group"; repo: string; added: number; removed: number }
	| { kind: "change"; change: GitFileChange };

/**
 * The Changed list virtualizes: a large worktree (tens of thousands of rows, every nested repository
 * included) would otherwise mount one button per file, and each filesystem tick would reconcile them.
 * Rows keep the same `data-testid`/`data-*` contract as the non-virtual list, so scope/status queries
 * still address a row by its path once it is in view.
 */
export function ChangedFileList({
	workspaceId,
	scope,
	changes,
	isActive,
	isViewed,
	onOpen,
}: {
	workspaceId: string;
	scope: string;
	changes: GitFileChange[];
	isActive: (path: string) => boolean;
	isViewed: (path: string) => boolean;
	onOpen: (path: string, intent: "preview" | "keep", claimPreview?: boolean) => void;
}) {
	const rows = useMemo<ChangedRow[]>(
		() =>
			groupChangesByRepo(changes).flatMap((group) => [
				...(group.repo
					? [
							{
								kind: "group" as const,
								repo: group.repo,
								added: group.added,
								removed: group.removed,
							},
						]
					: []),
				...group.changes.map((change) => ({ kind: "change" as const, change })),
			]),
		[changes],
	);
	const [initial] = useState(() => {
		const saved = selectFilesTreeView(useAppStore.getState(), workspaceId).scroll.changedList;
		return saved && saved.scope === scope ? { scrollTop: saved.top } : null;
	});
	const { elementRef, attach } = useScrollViewState<HTMLDivElement>(initial, (state) => {
		const top = (state as { scrollTop?: number } | null)?.scrollTop;
		if (typeof top === "number") {
			useAppStore.getState().setFilesTreeScroll(workspaceId, "changedList", top, scope);
		}
	});
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const scrollerRef = useCallback(
		(ref: HTMLElement | Window | null) => {
			attach(ref instanceof HTMLElement ? (ref as HTMLDivElement) : null);
		},
		[attach],
	);
	const onScroll = useCallback(() => {
		const node = elementRef.current;
		if (!node || saveTimer.current !== null) return;
		saveTimer.current = setTimeout(() => {
			saveTimer.current = null;
			useAppStore.getState().setFilesTreeScroll(workspaceId, "changedList", node.scrollTop, scope);
		}, SAVE_DELAY_MS);
	}, [elementRef, scope, workspaceId]);

	return (
		<Virtuoso<ChangedRow>
			className="h-full min-h-0 [overflow-anchor:none]"
			data={rows}
			computeItemKey={(_index, row) =>
				row.kind === "group" ? `repo:${row.repo}` : row.change.path
			}
			scrollerRef={scrollerRef}
			onScroll={onScroll}
			increaseViewportBy={{ top: 200, bottom: 400 }}
			itemContent={(_index, row) => {
				if (row.kind === "group") {
					return (
						<div
							data-testid="change-repo-group"
							className="flex h-panel-row items-center justify-between gap-4 px-4"
						>
							<NestedRepoTag repo={row.repo} />
							<DiffStatBadge added={row.added} removed={row.removed} />
						</div>
					);
				}
				const change = row.change;
				const { dir, base } = splitPath(change.path);
				const repoPrefix = change.repo ? `${change.repo}/` : "";
				const displayDir =
					repoPrefix && dir.startsWith(repoPrefix) ? dir.slice(repoPrefix.length) : dir;
				return (
					<ChangeRowActions
						path={change.path}
						active={isActive(change.path)}
						onView={() => onOpen(change.path, "preview")}
						onOpenTab={() => onOpen(change.path, "keep")}
					>
						{({ onContextMenu }) => (
							<button
								type="button"
								onContextMenu={onContextMenu}
								data-testid="change-item"
								data-status={change.status}
								data-repo={change.repo}
								data-submodule={change.submodule ? true : undefined}
								data-active={isActive(change.path) ? true : undefined}
								data-viewed={isViewed(change.path) ? true : undefined}
								onClick={firstClickOnly(() => onOpen(change.path, "preview"))}
								onDoubleClick={() => onOpen(change.path, "keep", true)}
								title={change.path}
								className="flex h-panel-row w-full min-w-0 items-center gap-8 px-4 text-left tr-text-ui"
							>
								<span
									className={`flex min-w-0 flex-1 items-baseline ${isViewed(change.path) ? "opacity-60" : ""}`}
								>
									{displayDir ? (
										<span
											data-testid="change-path-dir"
											className="min-w-0 shrink truncate text-text-muted"
										>
											{displayDir}
										</span>
									) : null}
									<span
										data-testid="change-path-base"
										className={`max-w-full shrink-0 truncate ${statusNameClass(change.status) || "text-text-muted"}`}
									>
										{base}
									</span>
								</span>
								{change.submodule ? <NestedRepoTag submodule /> : null}
								{isViewed(change.path) ? <ViewedMark /> : null}
								<DiffStatBadge added={change.added ?? 0} removed={change.removed ?? 0} />
							</button>
						)}
					</ChangeRowActions>
				);
			}}
		/>
	);
}
