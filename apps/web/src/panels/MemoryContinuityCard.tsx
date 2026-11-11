import type { MemoryPiConfigPatch } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { toast } from "../store";
import { SettingsSwitch } from "./SettingsSwitch";
import { useMemoryPiConfig } from "./useMemoryPiConfig";
import { useMemoryProjects } from "./useMemoryProjects";

/**
 * The Basic Memory Pi package's own per-project config (`.pi/basic-memory.json`): which Basic Memory
 * project it targets, and whether recall/capture run automatically. Every change is written at once.
 */
export function MemoryContinuityCard({ projectId }: { projectId: string }) {
	const t = useT();
	const state = useMemoryPiConfig(projectId);
	const projects = useMemoryProjects();
	if (!state.supported) return null;
	const config = state.config;

	const apply = (patch: MemoryPiConfigPatch) => {
		void state.save(patch).then((saved) => {
			if (!saved) toast.error(t("panels.projectSettings.memory.saveFailed"));
		});
	};

	const choices = projects.snapshot?.projects ?? [];

	return (
		<section
			data-testid="project-settings-memory"
			className="flex flex-col gap-8 border-border-muted border-t pt-12"
		>
			<div className="flex flex-col gap-2">
				<span className="tr-title-compact text-text-default">
					{t("panels.projectSettings.memory.title")}
				</span>
				<span className="text-text-muted tr-text-metadata">
					{t("panels.projectSettings.memory.description")}
				</span>
			</div>
			<div className="flex flex-col gap-4">
				<span className="tr-text-metadata text-text-subtle">
					{t("panels.projectSettings.memory.projectLabel")}
				</span>
				<div className="flex flex-wrap gap-4" data-testid="project-settings-memory-projects">
					<Button
						variant={config?.project ? "ghost" : "soft-primary"}
						size="s"
						data-testid="project-settings-memory-project-default"
						onClick={() => apply({ project: null })}
						disabled={state.saving}
					>
						{t("panels.projectSettings.memory.packageDefault")}
					</Button>
					{choices.map((choice) => (
						<Button
							key={choice.name}
							variant={config?.project === choice.name ? "soft-primary" : "ghost"}
							size="s"
							data-testid={`project-settings-memory-project-${choice.name}`}
							onClick={() => apply({ project: choice.name })}
							disabled={state.saving}
						>
							{choice.name}
						</Button>
					))}
				</div>
				{!state.saving && choices.length === 0 && (
					<span className="tr-text-metadata text-text-subtle">
						{t("panels.projectSettings.memory.noProjects")}
					</span>
				)}
			</div>
			<div className="flex items-center justify-between gap-8">
				<span className="tr-text-ui text-text-default">
					{t("panels.projectSettings.memory.autoRecall")}
				</span>
				<SettingsSwitch
					checked={config?.autoRecall !== false}
					label={t("panels.projectSettings.memory.autoRecall")}
					testId="project-settings-memory-auto-recall"
					onChange={(next) => apply({ autoRecall: next })}
					disabled={state.saving}
				/>
			</div>
			<div className="flex items-center justify-between gap-8">
				<span className="tr-text-ui text-text-default">
					{t("panels.projectSettings.memory.autoCapture")}
				</span>
				<SettingsSwitch
					checked={config?.autoCapture !== false}
					label={t("panels.projectSettings.memory.autoCapture")}
					testId="project-settings-memory-auto-capture"
					onChange={(next) => apply({ autoCapture: next })}
					disabled={state.saving}
				/>
			</div>
			{config && (
				<span
					data-testid="project-settings-memory-path"
					className="truncate tr-text-metadata text-text-subtle"
				>
					{config.path}
				</span>
			)}
		</section>
	);
}
