import { RiGamepadLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { FileChip } from "./FileChip";
import type { UnityEditorSelection } from "./unitySelection";

export function UnitySelectionChip({ selection }: { selection: UnityEditorSelection }) {
	const t = useT();
	return (
		<FileChip
			data-testid="composer-unity-selection"
			icon={false}
			title={
				selection.scene
					? t("unity.selection.titleWithScene", { path: selection.path, scene: selection.scene })
					: t("unity.selection.title", { path: selection.path })
			}
			label={
				<span className="flex min-w-0 items-center gap-4">
					<RiGamepadLine className="size-12 shrink-0 text-primary" />
					<span className="min-w-0 truncate">{selection.name}</span>
				</span>
			}
			meta={`· ${selection.type}`}
		/>
	);
}
