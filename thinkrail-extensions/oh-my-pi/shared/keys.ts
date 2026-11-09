export const OH_MY_PI_EXTENSION = "oh-my-pi";

export const OH_MY_PI_TOGGLES = {
	advisor: false,
	hashline: false,
	lspDiagnostics: false,
	modelRouting: false,
	rules: false,
	structuredResults: false,
} as const;

export type OhMyPiToggle = keyof typeof OH_MY_PI_TOGGLES;

export const OH_MY_PI_STRINGS = {
	advisorModel: "",
	apiKeys: "",
	lspCommands: "",
	routerDefault: "",
	routerFallback: "",
	routerFast: "",
	rulesDir: "",
} as const;

export type OhMyPiString = keyof typeof OH_MY_PI_STRINGS;

/** Which string setting renders under which switch; the panel iterates this, never its own copy. */
export const OH_MY_PI_FIELDS: Record<OhMyPiToggle, readonly OhMyPiString[]> = {
	advisor: ["advisorModel"],
	hashline: [],
	lspDiagnostics: ["lspCommands"],
	modelRouting: ["routerDefault", "routerFast", "routerFallback", "apiKeys"],
	rules: ["rulesDir"],
	structuredResults: [],
};
