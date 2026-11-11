import type { MemoryNoteSummary } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { toast, useAppStore } from "../store";
import { supportsMemoryEngine } from "../transport";
import { MemoryNoteDialog } from "./MemoryNoteDialog";
import { SettingsGroup, SettingsPageContainer } from "./SettingsGroup";
import { SettingsRow } from "./SettingsRow";
import { useMemoryEngine } from "./useMemoryEngine";
import { useMemoryNotes } from "./useMemoryNotes";

export function MemorySettings() {
	const t = useT();
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const supported = supportsMemoryEngine(protocolVersion);
	const engine = useMemoryEngine();
	const notes = useMemoryNotes();
	const [openNote, setOpenNote] = useState<MemoryNoteSummary | null>(null);
	const [noteContent, setNoteContent] = useState<string>("");

	const openNoteDialog = async (note: MemoryNoteSummary) => {
		try {
			setNoteContent(await notes.readNote(note.path));
			setOpenNote(note);
		} catch {
			toast.error(t("settings.memory.note.loadFailed"));
		}
	};

	const installInTerminal = async () => {
		const opened = await engine.install();
		if (!opened) toast.error(t("settings.memory.engine.installFailed"));
	};

	return (
		<SettingsPageContainer testId="settings-memory">
			<section className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">{t("settings.memory.title")}</h3>
				<p className="text-text-muted tr-text-metadata">
					{t(supported ? "settings.memory.description" : "settings.memory.unavailable")}
				</p>
			</section>
			{supported && (
				<SettingsGroup
					testId="memory-engine"
					title={t("settings.memory.engine.title")}
					description={t("settings.memory.engine.description")}
				>
					<SettingsRow
						label={t("settings.memory.engine.command")}
						control={
							engine.status === null ? (
								<span className="text-text-muted">{t("settings.memory.engine.checking")}</span>
							) : (
								<span
									data-testid="memory-engine-command"
									className={cn(
										"tr-text-metadata",
										engine.status.engine === "missing"
											? "text-feedback-error"
											: "text-text-default",
									)}
								>
									{t(
										engine.status.engine === "installed"
											? "settings.memory.engine.commandInstalled"
											: "settings.memory.engine.commandMissing",
									)}
								</span>
							)
						}
					/>
					<SettingsRow
						label={t("settings.memory.engine.uvx")}
						control={
							engine.status === null ? (
								<span className="text-text-muted">{t("settings.memory.engine.checking")}</span>
							) : (
								<span
									data-testid="memory-engine-uvx"
									className={cn(
										"tr-text-metadata",
										engine.status.uvx === "missing" ? "text-feedback-error" : "text-text-default",
									)}
								>
									{t(
										engine.status.uvx === "installed"
											? "settings.memory.engine.uvxInstalled"
											: "settings.memory.engine.uvxMissing",
									)}
								</span>
							)
						}
					/>
					<div className="flex gap-8">
						<Button data-testid="memory-engine-install" onClick={() => void installInTerminal()}>
							{t("settings.memory.engine.install")}
						</Button>
						<Button
							variant="ghost"
							size="m"
							data-testid="memory-engine-recheck"
							onClick={engine.recheck}
							disabled={engine.checking}
						>
							{t("settings.memory.engine.recheck")}
						</Button>
					</div>
				</SettingsGroup>
			)}
			{notes.supported && (
				<SettingsGroup
					testId="memory-notes"
					title={t("settings.memory.notes.title")}
					description={t("settings.memory.notes.description")}
				>
					<SettingsRow
						label={t("settings.memory.notes.root")}
						control={
							<span data-testid="memory-notes-root" className="tr-text-metadata text-text-muted">
								{notes.snapshot?.root ?? t("settings.memory.engine.checking")}
							</span>
						}
					/>
					{notes.snapshot && !notes.snapshot.exists && (
						<SettingsRow
							label={t("settings.memory.notes.state")}
							control={
								<span className="tr-text-metadata text-feedback-error">
									{t("settings.memory.notes.missing")}
								</span>
							}
						/>
					)}
					{notes.snapshot?.notes.length === 0 && notes.snapshot.exists && (
						<SettingsRow
							label={t("settings.memory.notes.state")}
							control={
								<span className="tr-text-metadata text-text-muted">
									{t("settings.memory.notes.empty")}
								</span>
							}
						/>
					)}
					{notes.snapshot && notes.snapshot.notes.length > 0 && (
						<ul className="flex w-full flex-col gap-4" data-testid="memory-notes-list">
							{notes.snapshot.notes.map((note) => (
								<li key={note.path} className="flex items-center gap-8">
									<Button
										variant="ghost"
										size="m"
										data-testid={`memory-note-${note.path}`}
										className="min-w-0 flex-1 justify-start gap-8"
										onClick={() => void openNoteDialog(note)}
									>
										<span className="truncate text-text-default">{note.title}</span>
										<span className="truncate text-text-muted tr-text-metadata">{note.path}</span>
									</Button>
								</li>
							))}
						</ul>
					)}
					<div className="flex gap-8">
						<Button
							variant="ghost"
							size="m"
							data-testid="memory-notes-reload"
							onClick={notes.reload}
							disabled={notes.loading}
						>
							{t("settings.memory.notes.reload")}
						</Button>
					</div>
				</SettingsGroup>
			)}
			{openNote && (
				<MemoryNoteDialog
					note={openNote}
					content={noteContent}
					onClose={() => setOpenNote(null)}
					onSave={async (content) => {
						await notes.saveNote(openNote.path, content);
					}}
				/>
			)}
		</SettingsPageContainer>
	);
}
