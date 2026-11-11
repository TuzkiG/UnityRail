import { RiFileTextLine as FileText, RiRefreshLine as Refresh } from "@remixicon/react";
import type { MemoryNoteSummary } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useMemo, useState } from "react";
import { toast, useAppStore } from "../store";
import { errorText } from "../transport";
import { useMemoryNotes } from "./useMemoryNotes";

/**
 * A project's memory as a center-tab document: the project's own Basic Memory folder and the shared
 * user-level notes side by side, with an editor that writes Markdown straight to disk.
 */
export default function MemoryPane({ projectId }: { projectId: string }) {
	const t = useT();
	const projectName = useAppStore(
		(state) => state.projects.find((project) => project.id === projectId)?.name ?? null,
	);
	const projectNotes = useMemoryNotes(projectId);
	const userNotes = useMemoryNotes();
	const [selected, setSelected] = useState<{
		scope: "project" | "user";
		note: MemoryNoteSummary;
	} | null>(null);
	const [content, setContent] = useState("");
	const [draft, setDraft] = useState("");
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);

	const scoped = selected?.scope === "project" ? projectNotes : userNotes;
	const readNote = scoped.readNote;
	const saveNote = scoped.saveNote;
	const dirty = content !== draft;

	useEffect(() => {
		if (!selected) return;
		let cancelled = false;
		setLoading(true);
		readNote(selected.note.path)
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
			await saveNote(selected.note.path, draft);
			setContent(draft);
			toast.success(t("memory.pane.saved"));
		} catch (error) {
			toast.error(errorText(error), t("memory.pane.saveFailed"));
		} finally {
			setSaving(false);
		}
	};

	const sections = useMemo(
		() => [
			{
				key: "project" as const,
				label: t("memory.pane.projectSection", {
					name: projectName ?? t("memory.pane.thisProject"),
				}),
				notes: projectNotes,
			},
			{ key: "user" as const, label: t("memory.pane.userSection"), notes: userNotes },
		],
		[projectName, projectNotes, t, userNotes],
	);

	return (
		<div data-testid="memory-pane" className="flex h-full min-h-0">
			<div className="flex w-[280px] shrink-0 flex-col border-border-default border-r bg-container-sidebar-bg">
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
							projectNotes.reload();
							userNotes.reload();
						}}
					/>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">
					{sections.map((section) => (
						<div key={section.key} className="pb-8">
							<p className="truncate px-12 py-4 tr-text-metadata text-text-subtle">
								{section.label}
							</p>
							<NoteList
								state={section.notes}
								selectedPath={selected?.scope === section.key ? selected.note.path : null}
								emptyLabel={t("memory.pane.empty")}
								onSelect={(note) => setSelected({ scope: section.key, note })}
							/>
						</div>
					))}
				</div>
			</div>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				{selected ? (
					<>
						<div className="flex h-panel-header-row shrink-0 items-center justify-between gap-8 border-border-muted border-b px-16">
							<span className="min-w-0 truncate tr-text-ui text-text-default">
								{selected.note.title}
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
	state,
	selectedPath,
	emptyLabel,
	onSelect,
}: {
	state: ReturnType<typeof useMemoryNotes>;
	selectedPath: string | null;
	emptyLabel: string;
	onSelect: (note: MemoryNoteSummary) => void;
}) {
	const notes = state.snapshot?.notes ?? [];
	if (!state.supported || notes.length === 0) {
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
						<span className="min-w-0 truncate">{note.title}</span>
					</button>
				</li>
			))}
		</ul>
	);
}
