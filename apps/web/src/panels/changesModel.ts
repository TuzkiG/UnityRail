import type {
	GitCommit,
	GitDiffScope,
	GitFileChange,
	GitFileStatus,
	TurnChangeSet,
} from "@thinkrail/contracts";
import type { Translator } from "@thinkrail/locales/react";
import { VIRTUALIZED_DIFF_LINES } from "@thinkrail/resource-renderers";
import { ancestorPaths, tupleKey, turnTimeLabel } from "../lib";
import { extendFolderChain, startFolderChain } from "./folderChains";

export function statusNameClass(status: GitFileStatus): string {
	switch (status) {
		case "added":
		case "untracked":
			return "text-feedback-success";
		case "deleted":
			return "text-feedback-error line-through";
		case "renamed":
			return "text-feedback-info";
		default:
			return "";
	}
}

export function statusMarkClass(status: GitFileStatus): string {
	return statusNameClass(status) || "text-feedback-warning";
}

export interface ChangeMarks {
	files: ReadonlyMap<string, GitFileStatus>;
	dirs: ReadonlySet<string>;
}

export function buildChangeMarks(changes: readonly GitFileChange[]): ChangeMarks {
	const files = new Map<string, GitFileStatus>();
	const dirs = new Set<string>();
	for (const change of changes) {
		if (change.status === "deleted") continue;
		files.set(change.path, change.status);
		for (const dir of ancestorPaths(change.path)) dirs.add(dir);
	}
	return { files, dirs };
}

export function scopeKey(scope: GitDiffScope): string {
	if (scope.kind === "commit") return `commit:${scope.sha}`;
	if (scope.kind === "pinned") return `pinned:${scope.baseRef}`;
	if (scope.kind === "turn") return `turn:${scope.id}`;
	if (scope.kind === "branch" && (scope.repo || scope.baseRef)) {
		return `branch:${scope.repo ?? ""}:${scope.baseRef ?? ""}`;
	}
	return scope.kind;
}

export function turnScope(turn: TurnChangeSet): Extract<GitDiffScope, { kind: "turn" }> {
	return {
		kind: "turn",
		id: turn.id,
		baseTree: turn.baseTree,
		headTree: turn.headTree,
		startedAt: turn.startedAt,
		...(turn.nestedTrees ? { nestedTrees: turn.nestedTrees } : {}),
	};
}

export function diffTabId(workspaceId: string, scope: GitDiffScope, path: string): string {
	return tupleKey("diff", workspaceId, scopeKey(scope), path);
}

export function changesTabId(workspaceId: string, scope: GitDiffScope): string {
	return tupleKey("changes", workspaceId, scopeKey(scope));
}

const GENERATED_PATH =
	/(^|\/)([^/]*\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|[^/]*\.min\.(js|css)|[^/]*\.snap|[^/]*\.map)$/;
export const LARGE_SECTION_LINES = 400;
export const LARGE_SCOPE_FILES = 50;

export function sectionCollapsedByDefault(change: GitFileChange): boolean {
	return (
		(change.added ?? 0) + (change.removed ?? 0) > LARGE_SECTION_LINES ||
		GENERATED_PATH.test(change.path)
	);
}

const SECTION_CHROME_HEIGHT = 232;
const SECTION_HEIGHT_PER_LINE = 40;
const SECTION_HEIGHT_MAX = 20_000;

export function stackedDiffBounded(
	boundedDiff: "always" | "large" | undefined,
	lineCount: number,
): boolean {
	return (
		boundedDiff === "always" || (boundedDiff === "large" && lineCount > VIRTUALIZED_DIFF_LINES)
	);
}

export function estimatedSectionHeight(change: GitFileChange): number {
	const lines = (change.added ?? 0) + (change.removed ?? 0);
	return Math.min(SECTION_HEIGHT_MAX, SECTION_CHROME_HEIGHT + lines * SECTION_HEIGHT_PER_LINE);
}

export function scopeLabel(
	t: Translator,
	scope: GitDiffScope,
	commits: readonly GitCommit[] = [],
	turns: readonly TurnChangeSet[] = [],
): string {
	if (scope.kind === "branch") return t("changes.scope.all");
	if (scope.kind === "uncommitted") return t("changes.scope.uncommitted");
	if (scope.kind === "pinned") return scope.baseRef.slice(0, 7);
	if (scope.kind === "turn") {
		const latest = turns.at(-1);
		return latest && latest.id === scope.id
			? t("changes.scope.lastTurn")
			: t("changes.scope.turn", { time: turnTimeLabel(t, scope.startedAt) });
	}
	const known = commits.find((c) => c.sha === scope.sha);
	return known?.shortSha ?? scope.sha.slice(0, 7);
}

export function scopeTitle(
	t: Translator,
	scope: GitDiffScope,
	commits: readonly GitCommit[] = [],
	turns: readonly TurnChangeSet[] = [],
): string {
	if (scope.kind === "turn") {
		const files = turns.find((turn) => turn.id === scope.id)?.changes.length;
		const time = turnTimeLabel(t, scope.startedAt);
		return files === undefined
			? t("changes.scope.turnTitle", { time })
			: t("changes.scope.turnTitleFiles", { time, count: files });
	}
	if (scope.kind !== "commit") return t("changes.scope.title", { label: scopeLabel(t, scope) });
	const known = commits.find((c) => c.sha === scope.sha);
	return known?.subject ? `${known.shortSha} · ${known.subject}` : scopeLabel(t, scope, commits);
}

export function splitPath(path: string): { dir: string; base: string } {
	const cut = path.lastIndexOf("/");
	return cut < 0
		? { dir: "", base: path }
		: { dir: path.slice(0, cut + 1), base: path.slice(cut + 1) };
}

export interface ChangeTreeFile {
	kind: "file";
	name: string;
	path: string;
	status: GitFileStatus;
	submodule?: boolean;
	added: number;
	removed: number;
}
export interface ChangeTreeDir {
	kind: "dir";
	name: string;
	path: string;
	children: ChangeTreeNode[];
	added: number;
	removed: number;
	/** The root of a nested repository, rendered as a repository group rather than a plain folder. */
	repo?: boolean;
}
export type ChangeTreeNode = ChangeTreeDir | ChangeTreeFile;

export interface ChangeRepoGroup {
	repo: string;
	changes: GitFileChange[];
	added: number;
	removed: number;
}

/** The workspace root keeps the whole change set; selecting a nested repository limits it to that
 * repository's rows. The Changed tab and its +/- counts use this one filter. */
export function changesForRepo(changes: readonly GitFileChange[], repo: string): GitFileChange[] {
	return repo ? changes.filter((change) => change.repo === repo) : [...changes];
}

/** Root changes stay first; nested repositories are grouped by their workspace-relative root. */
export function groupChangesByRepo(changes: readonly GitFileChange[]): ChangeRepoGroup[] {
	const groups = new Map<string, GitFileChange[]>();
	for (const change of changes) {
		const repo = change.repo ?? "";
		const held = groups.get(repo);
		if (held) held.push(change);
		else groups.set(repo, [change]);
	}
	return [...groups.entries()]
		.map(([repo, rows]) => ({
			repo,
			changes: rows,
			added: rows.reduce((sum, change) => sum + (change.added ?? 0), 0),
			removed: rows.reduce((sum, change) => sum + (change.removed ?? 0), 0),
		}))
		.sort((a, b) => (a.repo === "" ? -1 : b.repo === "" ? 1 : a.repo.localeCompare(b.repo)));
}

export interface ReviewChangeRow {
	change: GitFileChange;
	/** Set only on the row that opens a nested repository's block; the review list repeats it as a header. */
	group: ChangeRepoGroup | null;
}

/** The review list names each repository once and then lists its own files contiguously, so a walk
 * through it never jumps between repositories. Root changes keep their order first. */
export function reviewChangeRows(changes: readonly GitFileChange[]): ReviewChangeRow[] {
	return groupChangesByRepo(changes).flatMap((group) =>
		group.changes.map((change, index) => ({
			change,
			group: group.repo !== "" && index === 0 ? group : null,
		})),
	);
}

export function repoChangeTree(group: ChangeRepoGroup): ChangeTreeDir {
	return {
		kind: "dir",
		name: group.repo,
		path: group.repo,
		children: buildChangesTree(group.changes, group.repo),
		added: group.added,
		removed: group.removed,
		repo: true,
	};
}

interface DirBuild {
	dirs: Map<string, DirBuild>;
	files: ChangeTreeFile[];
}

/** `displayRoot` is the nested repository root whose label is the group header; file paths stay
 * workspace-relative for opening, while the tree only shows the portion below that root. */
export function buildChangesTree(
	changes: readonly GitFileChange[],
	displayRoot = "",
): ChangeTreeNode[] {
	const root: DirBuild = { dirs: new Map(), files: [] };

	for (const change of changes) {
		const relative =
			displayRoot && change.path.startsWith(`${displayRoot}/`)
				? change.path.slice(displayRoot.length + 1)
				: change.path;
		const segments = relative.split("/");
		const fileName = segments.pop() ?? change.path;
		let dir = root;
		for (const segment of segments) {
			let next = dir.dirs.get(segment);
			if (!next) {
				next = { dirs: new Map(), files: [] };
				dir.dirs.set(segment, next);
			}
			dir = next;
		}
		dir.files.push({
			kind: "file",
			name: fileName,
			path: change.path,
			status: change.status,
			...(change.submodule ? { submodule: true } : {}),
			added: change.added ?? 0,
			removed: change.removed ?? 0,
		});
	}

	const materialize = (build: DirBuild, prefix: string): ChangeTreeNode[] => {
		const dirNodes: ChangeTreeDir[] = [...build.dirs.entries()]
			.map(([name, child]): ChangeTreeDir => {
				const initialPath = prefix ? `${prefix}/${name}` : name;
				let chain = startFolderChain({ kind: "dir", name, path: initialPath });
				let children = materialize(child, initialPath);
				for (;;) {
					const extension = extendFolderChain(chain, children);
					if (!extension) break;
					chain = extension.chain;
					children = extension.directory.children;
				}
				let added = 0;
				let removed = 0;
				for (const node of children) {
					added += node.added;
					removed += node.removed;
				}
				return { kind: "dir", name: chain.label, path: chain.path, children, added, removed };
			})
			.sort((a, b) => a.name.localeCompare(b.name));
		const fileNodes = [...build.files].sort((a, b) => a.name.localeCompare(b.name));
		return [...dirNodes, ...fileNodes];
	};

	return materialize(root, "");
}

export function changeTreeFolderPaths(nodes: readonly ChangeTreeNode[]): string[] {
	return nodes.flatMap((node) =>
		node.kind === "dir" ? [node.path, ...changeTreeFolderPaths(node.children)] : [],
	);
}
