import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { toast, useAppStore } from "../store";
import { supportsMemoryEngine } from "../transport";
import { SettingsGroup, SettingsPageContainer } from "./SettingsGroup";
import { SettingsRow } from "./SettingsRow";
import { useMemoryEngine } from "./useMemoryEngine";

export function MemorySettings() {
	const t = useT();
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const supported = supportsMemoryEngine(protocolVersion);
	const engine = useMemoryEngine();

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
		</SettingsPageContainer>
	);
}
