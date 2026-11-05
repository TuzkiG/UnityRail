import { RiGitRepositoryLine } from "@remixicon/react";
import type { GitFileChange } from "@thinkrail/contracts";
import { firstClickOnly } from "../lib";
import type { TabIntent } from "../store";
import { ChangeRowActions, ROW_MENU_SLOT } from "./ChangeRowActions";
import {
	buildChangesTree,
	type ChangeTreeNode,
	groupChangesByRepo,
	repoChangeTree,
	statusNameClass,
} from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";
import { NestedRepoTag } from "./NestedRepoTag";
import { TreeRow } from "./TreeRow";
import { ViewedMark } from "./ViewedMark";

interface ChangeRowProps {
	onOpen: (path: string, intent: TabIntent, claimPreview?: boolean) => void;
	isActive: (path: string) => boolean;
	isViewed: (path: string) => boolean;
	isCollapsed: (path: string) => boolean;
	onSetCollapsed: (path: string, collapsed: boolean) => void;
	collapseKeyPrefix?: string;
}

export function ChangesTree({
	changes,
	...rowProps
}: ChangeRowProps & { changes: readonly GitFileChange[] }) {
	const groups = groupChangesByRepo(changes);
	return (
		<ul className="flex flex-col motion-safe:animate-reveal">
			{groups.map((group) =>
				group.repo ? (
					<ChangeNodeRow
						key={group.repo}
						node={repoChangeTree(group)}
						{...rowProps}
						collapseKeyPrefix={group.repo}
					/>
				) : (
					buildChangesTree(group.changes).map((node) => (
						<ChangeNodeRow key={node.path} node={node} {...rowProps} />
					))
				),
			)}
		</ul>
	);
}

function ChangeNodeRow({ node, ...rowProps }: ChangeRowProps & { node: ChangeTreeNode }) {
	const { onOpen, isActive, isViewed, isCollapsed, onSetCollapsed, collapseKeyPrefix } = rowProps;

	if (node.kind === "file") {
		return (
			<li>
				<ChangeRowActions
					path={node.path}
					active={isActive(node.path)}
					onView={() => onOpen(node.path, "preview")}
					onOpenTab={() => onOpen(node.path, "keep")}
				>
					{({ onContextMenu }) => (
						<TreeRow
							testid="change-item"
							onContextMenu={onContextMenu}
							kind="file"
							highlight="wrapper"
							active={isActive(node.path)}
							dataStatus={node.status}
							dataViewed={isViewed(node.path)}
							dataRepo={collapseKeyPrefix}
							dataSubmodule={node.submodule}
							label={node.name}
							labelClassName={`${statusNameClass(node.status)} ${isViewed(node.path) ? "opacity-60" : ""}`}
							onClick={firstClickOnly(() => onOpen(node.path, "preview"))}
							onDoubleClick={() => onOpen(node.path, "keep", true)}
							trailing={
								<>
									{node.submodule ? <NestedRepoTag submodule /> : null}
									{isViewed(node.path) ? <ViewedMark /> : null}
									<DiffStatBadge added={node.added} removed={node.removed} />
								</>
							}
						/>
					)}
				</ChangeRowActions>
			</li>
		);
	}

	const collapseKey = collapseKeyPrefix ? `${collapseKeyPrefix}:${node.path}` : node.path;
	const expanded = !isCollapsed(collapseKey);
	return (
		<li>
			<div className="flex min-w-0 items-center">
				<TreeRow
					testid={node.repo ? "change-repo-group" : "change-tree-folder"}
					kind="dir"
					expanded={expanded}
					label={node.name}
					leading={
						node.repo ? (
							<RiGitRepositoryLine className="size-14 shrink-0 text-text-muted" aria-hidden />
						) : undefined
					}
					onClick={() => onSetCollapsed(collapseKey, expanded)}
					trailing={expanded ? null : <DiffStatBadge added={node.added} removed={node.removed} />}
				/>
				<span className={ROW_MENU_SLOT} />
			</div>
			{expanded && (
				<ul className="flex flex-col pl-tree-indent">
					{node.children.map((child) => (
						<ChangeNodeRow key={child.path} node={child} {...rowProps} />
					))}
				</ul>
			)}
		</li>
	);
}
