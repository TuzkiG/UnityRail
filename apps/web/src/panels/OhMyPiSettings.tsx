import type { ExtensionSettingValue } from "@thinkrail/contracts";
import {
	OH_MY_PI_EXTENSION,
	OH_MY_PI_FIELD_COPY,
	OH_MY_PI_FIELDS,
	OH_MY_PI_TOGGLE_COPY,
	OH_MY_PI_TOGGLES,
	type OhMyPiString,
	type OhMyPiToggle,
} from "@thinkrail/ext-oh-my-pi/web";
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
const TOGGLES = Object.keys(OH_MY_PI_TOGGLES) as OhMyPiToggle[];

function stringValue(value: ExtensionSettingValue | undefined): string {
	return typeof value === "string" ? value : "";
}

function extensionUpdate(key: string, value: ExtensionSettingValue) {
	return { extensionSettings: { [OH_MY_PI_EXTENSION]: { [key]: value } } };
}

function TextSetting({
	field,
	value,
	disabled,
}: {
	field: OhMyPiString;
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
			return saveSettings(extensionUpdate(field, next), t("settings.ohMyPi.saveFailed"));
		},
	});

	return (
		<SettingsRow
			testId={`oh-my-pi-field-${field}`}
			label={t(OH_MY_PI_FIELD_COPY[field].title)}
			description={t(OH_MY_PI_FIELD_COPY[field].description)}
			control={
				<input
					type="text"
					{...inputProps}
					placeholder={t(OH_MY_PI_FIELD_COPY[field].placeholder)}
					aria-label={t(OH_MY_PI_FIELD_COPY[field].title)}
					disabled={disabled}
					data-testid={`oh-my-pi-input-${field}`}
					className={cn(SETTINGS_INPUT, "w-240")}
				/>
			}
		/>
	);
}

export function OhMyPiSettings() {
	const t = useT();
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const supported = supportsExtensionStringSettings(protocolVersion);
	const values = useAppStore((state) => state.extensionSettings[OH_MY_PI_EXTENSION]) ?? NO_SETTINGS;

	return (
		<SettingsPageContainer testId="settings-oh-my-pi">
			<section className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">{t("settings.ohMyPi.title")}</h3>
				<p className="text-text-muted tr-text-metadata">
					{t(supported ? "settings.ohMyPi.description" : "settings.ohMyPi.unavailable")}
				</p>
			</section>
			{TOGGLES.map((toggle) => (
				<SettingsGroup
					key={toggle}
					testId={`oh-my-pi-group-${toggle}`}
					title={t(OH_MY_PI_TOGGLE_COPY[toggle].title)}
					description={t(OH_MY_PI_TOGGLE_COPY[toggle].description)}
				>
					<SettingsRow
						label={t("settings.ohMyPi.enable")}
						control={
							<SettingsSwitch
								checked={values[toggle] === true}
								disabled={!supported}
								label={t(OH_MY_PI_TOGGLE_COPY[toggle].title)}
								testId={`oh-my-pi-toggle-${toggle}`}
								onChange={(next) => {
									void saveSettings(extensionUpdate(toggle, next), t("settings.ohMyPi.saveFailed"));
								}}
							/>
						}
					/>
					{OH_MY_PI_FIELDS[toggle].map((field) => (
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
