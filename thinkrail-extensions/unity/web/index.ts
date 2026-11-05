import { defineWebExtension, type ToolRenderProps } from "@thinkrail/extension-api/web";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import { UnityToolCard } from "./UnityToolCard";

const LABEL_KEYS: Record<string, MessageKey> = {
	unity_open_editor: "unity.tool.openEditor.label",
	unity_compile: "unity.tool.compile.label",
	unity_console: "unity.tool.console.label",
	unity_tests: "unity.tool.tests.label",
	unity_screenshot: "unity.tool.screenshot.label",
	unity_hierarchy: "unity.tool.hierarchy.label",
	unity_inspect: "unity.tool.inspect.label",
	unity_find: "unity.tool.find.label",
	unity_verify: "unity.tool.verify.label",
	unity_status: "unity.tool.status.label",
	unity_project: "unity.tool.project.label",
	unity_doctor: "unity.tool.doctor.label",
};

const PLAY_ACTION_KEYS: Record<string, MessageKey> = {
	play: "unity.action.play",
	stop: "unity.action.stop",
	pause: "unity.action.pause",
	resume: "unity.action.resume",
	step: "unity.action.step",
};

const SCREENSHOT_VIEW_KEYS: Record<string, MessageKey> = {
	game: "unity.tab.game",
	scene: "unity.tab.scene",
};

const label = (toolName: string, t: Translator): string => {
	const key = LABEL_KEYS[toolName];
	return key ? t(key) : toolName;
};

/** Tool results are `{ content, details, isError }`; summaries read the structured `details`. */
function detailsOf(result: unknown): Record<string, unknown> | null {
	if (!result || typeof result !== "object" || !("details" in result)) return null;
	const details = (result as { details?: unknown }).details;
	return details && typeof details === "object" && !Array.isArray(details)
		? (details as Record<string, unknown>)
		: null;
}

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function listValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function summaryFor(toolName: string, t: Translator, result: unknown): string {
	const details = detailsOf(result);
	switch (toolName) {
		case "unity_compile": {
			const diagnostics = listValue(details?.diagnostics) as Array<{ severity?: unknown }>;
			return t("unity.tool.compile.summary", {
				errors: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
				warnings: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
			});
		}
		case "unity_console":
			return t("unity.tool.console.summary", {
				count: listValue(details?.entries).length,
			});
		case "unity_tests":
			return t("unity.tool.tests.summary", {
				passed: numberValue(details?.passed),
				failed: numberValue(details?.failed),
			});
		case "unity_hierarchy":
			return t("unity.tool.hierarchy.summary", {
				scene: typeof details?.scene === "string" ? details.scene : "",
				count: listValue(details?.roots).length,
			});
		case "unity_inspect":
			return t("unity.tool.inspect.summary", {
				name: typeof details?.name === "string" ? details.name : "",
				count: listValue(details?.components).length,
			});
		case "unity_find":
			return t("unity.tool.find.summary", { count: listValue(details).length });
		case "unity_project":
			return t("unity.tool.project.summary", {
				version: typeof details?.editorVersion === "string" ? details.editorVersion : "",
			});
		case "unity_doctor": {
			const findings = listValue(details?.findings) as Array<{ severity?: unknown }>;
			return t("unity.tool.doctor.summary", {
				errors: findings.filter((finding) => finding.severity === "error").length,
				warnings: findings.filter((finding) => finding.severity === "warning").length,
			});
		}
		case "unity_screenshot": {
			const view =
				typeof details?.view === "string"
					? t(SCREENSHOT_VIEW_KEYS[details.view] ?? "unity.tab.game")
					: "";
			return t("unity.tool.screenshot.summary", {
				view,
				width: numberValue(details?.width),
				height: numberValue(details?.height),
			});
		}
		case "unity_playmode": {
			const action =
				typeof details?.isPlaying === "boolean" ? (details.isPlaying ? "stop" : "play") : "step";
			return t(PLAY_ACTION_KEYS[action] ?? "unity.tool.status.label");
		}
		default:
			return "";
	}
}

function toolSummary(toolName: string): (props: ToolRenderProps, t: Translator) => string {
	return ({ result }, t) => summaryFor(toolName, t, result) || label(toolName, t);
}

export default defineWebExtension({
	name: "unity",
	toolRenderers: {
		unity_compile: {
			renderer: UnityToolCard,
			options: { summary: toolSummary("unity_compile") },
		},
		unity_console: {
			renderer: UnityToolCard,
			options: { summary: toolSummary("unity_console") },
		},
		unity_tests: {
			renderer: UnityToolCard,
			options: { summary: toolSummary("unity_tests") },
		},
		unity_screenshot: {
			renderer: UnityToolCard,
			options: { summary: toolSummary("unity_screenshot") },
		},
		unity_hierarchy: {
			renderer: UnityToolCard,
			options: { summary: toolSummary("unity_hierarchy") },
		},
		unity_inspect: {
			renderer: UnityToolCard,
			options: { summary: toolSummary("unity_inspect") },
		},
		unity_find: {
			renderer: UnityToolCard,
			options: { summary: toolSummary("unity_find") },
		},
		unity_verify: {
			renderer: UnityToolCard,
			options: {
				prominence: "primary",
				defaultExpanded: true,
				summary: ({ result }, t) => {
					const details = detailsOf(result);
					if (!details) return label("unity_verify", t);
					const compile = details.compile as Record<string, unknown> | undefined;
					const tests = details.tests as Record<string, unknown> | null | undefined;
					const compileText = summaryFor("unity_compile", t, { details: compile });
					const testsText = tests ? summaryFor("unity_tests", t, { details: tests }) : "";
					return testsText ? `${compileText} · ${testsText}` : compileText;
				},
			},
		},
		unity_status: {
			renderer: UnityToolCard,
			options: {
				summary: ({ result }, t) => {
					const details = detailsOf(result);
					const mode =
						details?.isPlaying === true
							? details.isPaused === true
								? t("unity.status.paused")
								: t("unity.status.playing")
							: t("unity.status.editMode");
					return t("unity.tool.status.summary", { mode });
				},
			},
		},
		unity_project: {
			renderer: UnityToolCard,
			options: { summary: toolSummary("unity_project") },
		},
		unity_doctor: {
			renderer: UnityToolCard,
			options: { prominence: "primary", summary: toolSummary("unity_doctor") },
		},
		unity_open: {
			renderer: UnityToolCard,
			options: {
				summary: ({ args }, t) =>
					t("unity.tool.open.summary", { path: (args.path as string) ?? "" }),
			},
		},
		unity_select: {
			renderer: UnityToolCard,
			options: {
				summary: ({ args }, t) =>
					t("unity.tool.select.summary", { path: (args.path as string) ?? "" }),
			},
		},
		unity_playmode: {
			renderer: UnityToolCard,
			options: {
				summary: ({ args }, t) => {
					const action = typeof args.action === "string" ? args.action : "";
					return action
						? t(PLAY_ACTION_KEYS[action] ?? "unity.tool.status.label")
						: label("unity_status", t);
				},
			},
		},
		unity_open_editor: {
			renderer: UnityToolCard,
			options: {
				summary: ({ result }, t) => {
					const details = detailsOf(result);
					const path = typeof details?.editorPath === "string" ? details.editorPath : "";
					return path
						? t("unity.tool.openEditor.summary", { path })
						: label("unity_open_editor", t);
				},
			},
		},
	},
});
