import { RiErrorWarningLine as Warning } from "@remixicon/react";
import type { MemoryNoteSummary, MemoryProject } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useState } from "react";
import { toast, useAppStore } from "../store";
import { supportsMemoryProjects } from "../transport";
import { MemoryNoteDialog } from "./MemoryNoteDialog";
import { SettingsGroup, SettingsPageContainer } from "./SettingsGroup";
import { SettingsRow } from "./SettingsRow";
import { useMemoryEngine } from "./useMemoryEngine";
import { useMemoryNotes } from "./useMemoryNotes";
import { preferredMemoryProject, useMemoryProjects } from "./useMemoryProjects";

function StateText({ ok, children }: { ok: boolean; children: React.ReactNode }) {
	return (
		<span className={cn("tr-text-metadata", ok ? "text-text-default" : "text-feedback-error")}>
			{children}
		</span>
	);
}

function ProjectRow({
	project,
	active,
	onSelect,
	onReveal,
}: {
	project: MemoryProject;
	active: boolean;
	onSelect: () => void;
	onReveal: () => void;
}) {
	const t = useT();
	return (
		<li className="flex items-center gap-8">
			<Button
				variant={active ? "soft-primary" : "ghost"}
				size="m"
				data-testid={`memory-project-${project.name}`}
				className="min-w-0 flex-1"
				onClick={onSelect}
			>
				<span className="flex min-w-0 flex-1 items-center justify-start gap-8">
					<span className="truncate">{project.name}</span>
					{project.isDefault && (
						<span className="shrink-0 rounded-full bg-container-elevated-bg px-6 tr-text-metadata text-text-subtle">
							{t("settings.memory.projects.default")}
						</span>
					)}
					<span className="min-w-0 flex-1 truncate text-left tr-text-metadata text-text-muted">
						{project.path}
					</span>
					{project.mode === "cloud" && (
						<span className="shrink-0 tr-text-metadata text-text-subtle">
							{t("settings.memory.projects.cloud")}
						</span>
					)}
					{!project.exists && <Warning className="size-12 shrink-0 text-feedback-warning" />}
				</span>
			</Button>
			<Button variant="ghost" size="s" onClick={onReveal}>
				{t("settings.memory.projects.reveal")}
			</Button>
		</li>
	);
}

export function MemorySettings() {
	const t = useT();
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const supported = supportsMemoryProjects(protocolVersion);
	const engine = useMemoryEngine();
	const projects = useMemoryProjects();
	const [selected, setSelected] = useState<string | null>(null);
	const [openNote, setOpenNote] = useState<MemoryNoteSummary | null>(null);
	const [noteContent, setNoteContent] = useState("");

	const project = projects.snapshot?.projects.find((row) => row.name === selected) ?? null;
	const notes = useMemoryNotes(project?.name ?? null);

	useEffect(() => {
		const preferred = preferredMemoryProject(projects.snapshot, selected);
		if (preferred && preferred.name !== selected) setSelected(preferred.name);
	}, [projects.snapshot, selected]);

	const installInTerminal = async () => {
		const opened = await engine.install();
		if (!opened) toast.error(t("settings.memory.engine.installFailed"));
	};

	const openNoteDialog = async (note: MemoryNoteSummary) => {
		try {
			setNoteContent(await notes.readNote(note.path));
			setOpenNote(note);
		} catch {
			toast.error(t("settings.memory.note.loadFailed"));
		}
	};

	const reveal = async (name: string) => {
		try {
			await projects.reveal(name);
		} catch {
			toast.error(t("settings.memory.projects.revealFailed"));
		}
	};

	const cli = engine.status?.cli;

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
						label={t("settings.memory.engine.cli")}
						control={
							engine.status === null ? (
								<span className="text-text-muted">{t("settings.memory.engine.checking")}</span>
							) : (
								<StateText ok={cli?.supported === true}>
									<span data-testid="memory-engine-cli">
										{!cli?.installed
											? t("settings.memory.engine.cliMissing")
											: cli.supported
												? t("settings.memory.engine.cliVersion", {
														version: cli.version ?? "?",
													})
												: t("settings.memory.engine.cliUnsupported", {
														version: cli.version ?? "?",
													})}
									</span>
								</StateText>
							)
						}
					/>
					<SettingsRow
						label={t("settings.memory.engine.uv")}
						control={
							engine.status === null ? (
								<span className="text-text-muted">{t("settings.memory.engine.checking")}</span>
							) : (
								<StateText ok={engine.status.uv}>
									<span data-testid="memory-engine-uv">
										{engine.status.uv
											? t("settings.memory.engine.uvPresent")
											: t("settings.memory.engine.uvMissing")}
									</span>
								</StateText>
							)
						}
					/>
					<SettingsRow
						label={t("settings.memory.engine.piPackage")}
						control={
							engine.status === null ? (
								<span className="text-text-muted">{t("settings.memory.engine.checking")}</span>
							) : (
								<StateText ok={engine.status.piPackage}>
									<span data-testid="memory-engine-pi-package">
										{engine.status.piPackage
											? t("settings.memory.engine.piPackageInstalled")
											: t("settings.memory.engine.piPackageMissing")}
									</span>
								</StateText>
							)
						}
					/>
					<SettingsRow
						label={t("settings.memory.engine.config")}
						control={
							<span
								data-testid="memory-engine-config"
								className="truncate tr-text-metadata text-text-muted"
							>
								{engine.status?.configPath ?? t("settings.memory.engine.checking")}
							</span>
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
			{supported && (
				<SettingsGroup
					testId="memory-projects"
					title={t("settings.memory.projects.title")}
					description={t("settings.memory.projects.description")}
				>
					{projects.snapshot === null ? (
						<SettingsRow
							label={t("settings.memory.projects.state")}
							control={
								<span className="text-text-muted">{t("settings.memory.engine.checking")}</span>
							}
						/>
					) : (
						<>
							<SettingsRow
								label={t("settings.memory.projects.config")}
								control={
									<span className="truncate tr-text-metadata text-text-muted">
										{projects.snapshot.configPath}
									</span>
								}
							/>
							<ul className="flex w-full flex-col gap-4" data-testid="memory-projects-list">
								{projects.snapshot.projects.map((row) => (
									<ProjectRow
										key={row.name}
										project={row}
										active={row.name === project?.name}
										onSelect={() => setSelected(row.name)}
										onReveal={() => void reveal(row.name)}
									/>
								))}
							</ul>
							<div className="flex gap-8">
								<Button
									variant="ghost"
									size="m"
									data-testid="memory-projects-reload"
									onClick={projects.reload}
									disabled={projects.loading}
								>
									{t("settings.memory.projects.reload")}
								</Button>
							</div>
						</>
					)}
				</SettingsGroup>
			)}
			{supported && project && (
				<SettingsGroup
					testId="memory-notes"
					title={t("settings.memory.notes.title", { project: project.name })}
					description={t("settings.memory.notes.description", { path: project.path })}
				>
					{notes.snapshot === null ? (
						<SettingsRow
							label={t("settings.memory.notes.state")}
							control={
								<span className="text-text-muted">{t("settings.memory.engine.checking")}</span>
							}
						/>
					) : notes.snapshot.notes.length === 0 ? (
						<SettingsRow
							label={t("settings.memory.notes.state")}
							control={
								<span className="tr-text-metadata text-text-muted">
									{notes.snapshot.exists
										? t("settings.memory.notes.empty")
										: t("settings.memory.notes.missing")}
								</span>
							}
						/>
					) : (
						<ul className="flex w-full flex-col gap-4" data-testid="memory-notes-list">
							{notes.snapshot.notes.map((note) => (
								<li key={note.path} className="flex items-center gap-8">
									<Button
										variant="ghost"
										size="m"
										data-testid={`memory-note-${note.path}`}
										className="min-w-0 flex-1"
										onClick={() => void openNoteDialog(note)}
									>
										<span className="flex min-w-0 flex-1 items-center justify-start gap-8">
											<span className="truncate text-text-default">{note.title}</span>
											<span className="truncate text-text-muted tr-text-metadata">{note.path}</span>
										</span>
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
