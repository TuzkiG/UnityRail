import type { ExtensionSettingValue } from "@thinkrail/contracts";
import {
	MEMORY_EXTENSION,
	MEMORY_FIELD_COPY,
	MEMORY_FIELDS,
	MEMORY_TOGGLE_COPY,
	MEMORY_TOGGLES,
	type MemoryString,
	type MemoryToggle,
} from "@thinkrail/ext-memory/web";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useAppStore } from "../store";
import { supportsExtensionStringSettings } from "../transport";
import { SettingsGroup, SettingsPageContainer } from "./SettingsGroup";
import { SettingsRow } from "./SettingsRow";
import { SettingsSwitch } from "./SettingsSwitch";
import { saveSettings } from "./saveSettings";
import { SETTINGS_INPUT, useSettingsDraft } from "./settingsDraft";

const NO_SETTINGS: Readonly<Record<string, ExtensionSettingValue>> = {};
const TOGGLES = Object.keys(MEMORY_TOGGLES) as MemoryToggle[];

function stringValue(value: ExtensionSettingValue | undefined): string {
	return typeof value === "string" ? value : "";
}

function extensionUpdate(key: string, value: ExtensionSettingValue) {
	return { extensionSettings: { [MEMORY_EXTENSION]: { [key]: value } } };
}

function TextSetting({
	field,
	value,
	disabled,
}: {
	field: MemoryString;
	value: string;
	disabled: boolean;
}) {
	const t = useT();
	const { inputProps } = useSettingsDraft({
		saved: value,
		isValid: () => true,
		commit: (draft) => {
			const next = draft.trim();
			if (next === value) return undefined;
			return saveSettings(extensionUpdate(field, next), t("settings.memory.saveFailed"));
		},
	});

	return (
		<SettingsRow
			testId={`memory-field-${field}`}
			label={t(MEMORY_FIELD_COPY[field].title)}
			description={t(MEMORY_FIELD_COPY[field].description)}
			control={
				<input
					type="text"
					{...inputProps}
					placeholder={t(MEMORY_FIELD_COPY[field].placeholder)}
					aria-label={t(MEMORY_FIELD_COPY[field].title)}
					disabled={disabled}
					data-testid={`memory-input-${field}`}
					className={cn(SETTINGS_INPUT, "w-240")}
				/>
			}
		/>
	);
}

export function MemorySettings() {
	const t = useT();
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const supported = supportsExtensionStringSettings(protocolVersion);
	const values = useAppStore((state) => state.extensionSettings[MEMORY_EXTENSION]) ?? NO_SETTINGS;

	return (
		<SettingsPageContainer testId="settings-memory">
			<section className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">{t("settings.memory.title")}</h3>
				<p className="text-text-muted tr-text-metadata">
					{t(supported ? "settings.memory.description" : "settings.memory.unavailable")}
				</p>
			</section>
			{TOGGLES.map((toggle) => (
				<SettingsGroup
					key={toggle}
					testId={`memory-group-${toggle}`}
					title={t(MEMORY_TOGGLE_COPY[toggle].title)}
					description={t(MEMORY_TOGGLE_COPY[toggle].description)}
				>
					<SettingsRow
						label={t("settings.memory.enable")}
						control={
							<SettingsSwitch
								checked={values[toggle] === true}
								disabled={!supported}
								label={t(MEMORY_TOGGLE_COPY[toggle].title)}
								testId={`memory-toggle-${toggle}`}
								onChange={(next) => {
									void saveSettings(extensionUpdate(toggle, next), t("settings.memory.saveFailed"));
								}}
							/>
						}
					/>
					{MEMORY_FIELDS[toggle].map((field) => (
						<TextSetting
							key={field}
							field={field}
							value={stringValue(values[field])}
							disabled={!supported}
						/>
					))}
				</SettingsGroup>
			))}
		</SettingsPageContainer>
	);
}
