import type { NewWorkspaceTarget } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { useState } from "react";
import { toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { SettingsRadioCards } from "./SettingsRadioCards";
import { projectWorkspaceTarget } from "./workspaceTarget";

export function ProjectSettingsDialog({
	open,
	projectId,
	onOpenChange,
}: {
	open: boolean;
	projectId: string;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useT();
	const project = useAppStore(
		(s) =>
			s.projects.find((p) => p.id === projectId) ??
			s.recentProjects.find((p) => p.id === projectId),
	);
	const [saving, setSaving] = useState<NewWorkspaceTarget | null>(null);
	const target = projectWorkspaceTarget(project);

	const select = (next: NewWorkspaceTarget) => {
		if (saving !== null || next === target) return;
		setSaving(next);
		getTransport()
			.request("project.setNewWorkspaceTarget", { id: projectId, target: next })
			.then((updated) => useAppStore.getState().applyProjectUpdated(updated))
			.catch((err) => toast.error(errorText(err, t("panels.projectSettings.saveFailed"))))
			.finally(() => setSaving(null));
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-[26rem]" data-testid="project-settings">
				<DialogHeader>
					<DialogTitle>{t("panels.projectSettings.title")}</DialogTitle>
					<DialogDescription>
						{t("panels.projectSettings.description", { name: project?.name ?? "" })}
					</DialogDescription>
				</DialogHeader>
				<SettingsRadioCards
					name="project-workspace-target"
					label={t("panels.projectSettings.targetLabel")}
					value={target}
					disabled={saving !== null}
					choices={[
						{
							id: "worktree",
							label: t("panels.newWorkspace.targetIsolated"),
							description: t("panels.projectSettings.targetIsolatedDescription"),
							testId: "project-settings-target-worktree",
						},
						{
							id: "default",
							label: t("panels.newWorkspace.targetDefault"),
							description: t("panels.projectSettings.targetDefaultDescription"),
							testId: "project-settings-target-default",
						},
					]}
					onSelect={select}
				/>
				<p className="text-text-muted tr-text-metadata">{t("panels.projectSettings.targetHint")}</p>
				<DialogFooter>
					<Button variant="primary" onClick={() => onOpenChange(false)}>
						{t("common.done")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
