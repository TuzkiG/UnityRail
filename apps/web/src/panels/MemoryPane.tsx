import { RiFileTextLine as FileText, RiRefreshLine as Refresh } from "@remixicon/react";
import type { MemoryNoteSummary } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useMemo, useState } from "react";
import { toast, useAppStore } from "../store";
import { errorText } from "../transport";
import { useMemoryNotes } from "./useMemoryNotes";
import { preferredMemoryProject, useMemoryProjects } from "./useMemoryProjects";

/**
 * Basic Memory as a center-tab document: the user's Basic Memory projects, the selected project's
 * notes, and an editor that writes Markdown straight to the project folder on disk.
 */
export default function MemoryPane({ projectId }: { projectId: string }) {
	const t = useT();
	const projectName = useAppStore(
		(state) => state.projects.find((project) => project.id === projectId)?.name ?? null,
	);
	const projects = useMemoryProjects();
	const [selectedProject, setSelectedProject] = useState<string | null>(null);
	const project = useMemo(
		() => preferredMemoryProject(projects.snapshot, selectedProject ?? projectName),
		[projectName, projects.snapshot, selectedProject],
	);
	const notes = useMemoryNotes(project?.name ?? null);
	const readNote = notes.readNote;
	const [selected, setSelected] = useState<MemoryNoteSummary | null>(null);
	const [content, setContent] = useState("");
	const [draft, setDraft] = useState("");
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);

	const dirty = content !== draft;

	useEffect(() => {
		if (!selected) return;
		let cancelled = false;
		setLoading(true);
		readNote(selected.path)
			.then((text) => {
				if (cancelled) return;
				setContent(text);
				setDraft(text);
			})
			.catch((error) => {
				if (!cancelled) toast.error(errorText(error), t("memory.pane.readFailed"));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [readNote, selected, t]);

	const save = async () => {
		if (!selected || !dirty || saving) return;
		setSaving(true);
		try {
			await notes.saveNote(selected.path, draft);
			setContent(draft);
			toast.success(t("memory.pane.saved"));
		} catch (error) {
			toast.error(errorText(error), t("memory.pane.saveFailed"));
		}
		setSaving(false);
	};

	const projectRows = projects.snapshot?.projects ?? [];

	return (
		<div data-testid="memory-pane" className="flex h-full min-h-0">
			<div className="flex w-[300px] shrink-0 flex-col border-border-default border-r bg-container-sidebar-bg">
				<div className="flex h-panel-header-row shrink-0 items-center justify-between gap-8 border-border-muted border-b px-12">
					<span className="min-w-0 truncate tr-title-compact text-text-default">
						{t("memory.pane.title")}
					</span>
					<IconButton
						variant="ghost"
						size="s"
						icon={Refresh}
						label={t("memory.pane.refresh")}
						data-testid="memory-pane-refresh"
						onClick={() => {
							projects.reload();
							notes.reload();
						}}
					/>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">
					<div className="pb-8">
						<p className="truncate px-12 py-4 tr-text-metadata text-text-subtle">
							{t("memory.pane.projectsSection")}
						</p>
						{projects.supported && projectRows.length > 0 ? (
							<ul className="flex flex-col">
								{projectRows.map((row) => (
									<li key={row.name}>
										<button
											type="button"
											data-testid="memory-pane-project"
											data-selected={row.name === project?.name || undefined}
											onClick={() => {
												setSelectedProject(row.name);
												setSelected(null);
											}}
											className={cn(
												"flex w-full items-center gap-8 px-12 py-4 text-left tr-text-ui text-text-default",
												"hover:bg-container-elevated-bg data-[selected]:bg-container-elevated-bg",
											)}
										>
											<span className="min-w-0 flex-1 truncate">{row.name}</span>
											{row.isDefault && (
												<span className="shrink-0 tr-text-metadata text-text-subtle">
													{t("memory.pane.defaultTag")}
												</span>
											)}
										</button>
									</li>
								))}
							</ul>
						) : (
							<p className="px-12 py-4 tr-text-metadata text-text-subtle">
								{t("memory.pane.noProjects")}
							</p>
						)}
					</div>
					<div className="pb-8">
						<p className="truncate px-12 py-4 tr-text-metadata text-text-subtle">
							{t("memory.pane.notesSection", { project: project?.name ?? "" })}
						</p>
						<NoteList
							notes={notes.snapshot?.notes ?? []}
							selectedPath={selected?.path ?? null}
							emptyLabel={t("memory.pane.empty")}
							onSelect={setSelected}
						/>
					</div>
				</div>
			</div>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				{selected ? (
					<>
						<div className="flex h-panel-header-row shrink-0 items-center justify-between gap-8 border-border-muted border-b px-16">
							<span className="min-w-0 truncate tr-text-ui text-text-default">
								{selected.title}
							</span>
							<div className="flex shrink-0 items-center gap-8">
								{dirty ? (
									<span className="tr-text-metadata text-feedback-warning">
										{t("memory.pane.unsaved")}
									</span>
								) : null}
								<Button
									size="s"
									variant="outline"
									data-testid="memory-pane-save"
									disabled={!dirty || saving}
									onClick={() => void save()}
								>
									{t("memory.pane.save")}
								</Button>
							</div>
						</div>
						<textarea
							data-testid="memory-pane-editor"
							spellCheck={false}
							value={draft}
							disabled={loading}
							onChange={(event) => setDraft(event.target.value)}
							className="min-h-0 flex-1 resize-none bg-container-content-bg px-16 py-12 text-text-default outline-none tr-code-text"
						/>
					</>
				) : (
					<div className="flex h-full items-center justify-center px-16 text-text-muted tr-text-ui">
						{t("memory.pane.pick")}
					</div>
				)}
			</div>
		</div>
	);
}

function NoteList({
	notes,
	selectedPath,
	emptyLabel,
	onSelect,
}: {
	notes: readonly MemoryNoteSummary[];
	selectedPath: string | null;
	emptyLabel: string;
	onSelect: (note: MemoryNoteSummary) => void;
}) {
	if (notes.length === 0) {
		return <p className="px-12 py-4 tr-text-metadata text-text-subtle">{emptyLabel}</p>;
	}
	return (
		<ul className="flex flex-col">
			{notes.map((note) => (
				<li key={note.path}>
					<button
						type="button"
						data-testid="memory-pane-note"
						data-selected={note.path === selectedPath || undefined}
						onClick={() => onSelect(note)}
						className={cn(
							"flex w-full items-center gap-8 px-12 py-4 text-left tr-text-ui text-text-default",
							"hover:bg-container-elevated-bg data-[selected]:bg-container-elevated-bg",
						)}
					>
						<FileText className="size-16 shrink-0 text-text-subtle" />
						<span className="min-w-0 flex-1 truncate">{note.title}</span>
						<span className="shrink-0 tr-text-metadata text-text-subtle">{note.path}</span>
					</button>
				</li>
			))}
		</ul>
	);
}
