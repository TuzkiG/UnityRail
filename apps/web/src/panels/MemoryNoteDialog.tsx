import type { MemoryNoteSummary } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useState } from "react";
import { Markdown } from "@/chat/Markdown";
import { toast } from "@/store";
import { SegmentedControl } from "./SegmentedControl";
import { SETTINGS_INPUT } from "./settingsDraft";

type Mode = "preview" | "edit";

export function MemoryNoteDialog({
	note,
	content,
	onClose,
	onSave,
}: {
	note: MemoryNoteSummary;
	content: string;
	onClose: () => void;
	onSave: (content: string) => Promise<void>;
}) {
	const t = useT();
	const [mode, setMode] = useState<Mode>("preview");
	const [draft, setDraft] = useState(content);
	const [saving, setSaving] = useState(false);
	useEffect(() => setDraft(content), [content]);

	const save = async () => {
		if (draft === content) return;
		setSaving(true);
		try {
			await onSave(draft);
			onClose();
		} catch {
			setSaving(false);
			toast.error(t("settings.memory.note.saveFailed"));
		}
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent data-testid="memory-note-dialog" className="max-w-[44rem]">
				<DialogHeader>
					<DialogTitle>{note.title}</DialogTitle>
					<DialogDescription>{note.path}</DialogDescription>
				</DialogHeader>
				<SegmentedControl<Mode>
					name="memory-note-mode"
					label={t("settings.memory.note.mode")}
					value={mode}
					onSelect={setMode}
					testId="memory-note-mode"
					options={[
						{ id: "preview", label: t("settings.memory.note.preview") },
						{ id: "edit", label: t("settings.memory.note.edit") },
					]}
				/>
				{mode === "preview" ? (
					<div
						data-testid="memory-note-preview"
						className="max-h-160 overflow-y-auto rounded-8 border border-border-default p-12"
					>
						<Markdown text={content} />
					</div>
				) : (
					<textarea
						data-testid="memory-note-editor"
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						spellCheck={false}
						className={cn(SETTINGS_INPUT, "h-160 w-full resize-none font-mono text-12")}
					/>
				)}
				<div className="flex justify-end gap-8">
					<Button variant="ghost" size="m" onClick={onClose}>
						{t("settings.memory.note.close")}
					</Button>
					{mode === "edit" && (
						<Button
							data-testid="memory-note-save"
							loading={saving}
							disabled={draft === content}
							onClick={() => void save()}
						>
							{t("settings.memory.note.save")}
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
