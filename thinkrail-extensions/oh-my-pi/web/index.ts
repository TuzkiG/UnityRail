import type { MessageKey } from "@thinkrail/locales";
import type { OhMyPiString, OhMyPiToggle } from "../shared/keys";

export {
	OH_MY_PI_EXTENSION,
	OH_MY_PI_FIELDS,
	OH_MY_PI_STRINGS,
	OH_MY_PI_TOGGLES,
	type OhMyPiString,
	type OhMyPiToggle,
} from "../shared/keys";
export {
	type HashlineOp,
	insertedLines,
	isHashlineOp,
} from "../shared/ops";

interface ToggleCopy {
	title: MessageKey;
	description: MessageKey;
}

interface FieldCopy extends ToggleCopy {
	placeholder: MessageKey;
}

/** Total by key: adding a toggle or string to `shared/keys.ts` without copy fails the typecheck. */
export const OH_MY_PI_TOGGLE_COPY = {
	advisor: {
		title: "settings.ohMyPi.advisor.title",
		description: "settings.ohMyPi.advisor.description",
	},
	hashline: {
		title: "settings.ohMyPi.hashline.title",
		description: "settings.ohMyPi.hashline.description",
	},
	lspDiagnostics: {
		title: "settings.ohMyPi.lspDiagnostics.title",
		description: "settings.ohMyPi.lspDiagnostics.description",
	},
	modelRouting: {
		title: "settings.ohMyPi.modelRouting.title",
		description: "settings.ohMyPi.modelRouting.description",
	},
	rules: {
		title: "settings.ohMyPi.rules.title",
		description: "settings.ohMyPi.rules.description",
	},
	structuredResults: {
		title: "settings.ohMyPi.structuredResults.title",
		description: "settings.ohMyPi.structuredResults.description",
	},
} satisfies Record<OhMyPiToggle, ToggleCopy>;

export const OH_MY_PI_FIELD_COPY = {
	advisorModel: {
		title: "settings.ohMyPi.advisorModel.title",
		description: "settings.ohMyPi.advisorModel.description",
		placeholder: "settings.ohMyPi.advisorModel.placeholder",
	},
	apiKeys: {
		title: "settings.ohMyPi.apiKeys.title",
		description: "settings.ohMyPi.apiKeys.description",
		placeholder: "settings.ohMyPi.apiKeys.placeholder",
	},
	lspCommands: {
		title: "settings.ohMyPi.lspCommands.title",
		description: "settings.ohMyPi.lspCommands.description",
		placeholder: "settings.ohMyPi.lspCommands.placeholder",
	},
	routerDefault: {
		title: "settings.ohMyPi.routerDefault.title",
		description: "settings.ohMyPi.routerDefault.description",
		placeholder: "settings.ohMyPi.routerDefault.placeholder",
	},
	routerFallback: {
		title: "settings.ohMyPi.routerFallback.title",
		description: "settings.ohMyPi.routerFallback.description",
		placeholder: "settings.ohMyPi.routerFallback.placeholder",
	},
	routerFast: {
		title: "settings.ohMyPi.routerFast.title",
		description: "settings.ohMyPi.routerFast.description",
		placeholder: "settings.ohMyPi.routerFast.placeholder",
	},
	rulesDir: {
		title: "settings.ohMyPi.rulesDir.title",
		description: "settings.ohMyPi.rulesDir.description",
		placeholder: "settings.ohMyPi.rulesDir.placeholder",
	},
} satisfies Record<OhMyPiString, FieldCopy>;
