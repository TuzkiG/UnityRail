import type {
	ExtensionAPI,
	ExtensionContext,
	ModelRegistry,
} from "@earendil-works/pi-coding-agent";

type Model = Parameters<ModelRegistry["complete"]>[0];
type RouteRequest = Parameters<
	NonNullable<Parameters<ExtensionAPI["registerVirtualModel"]>[0]["route"]>
>[0];
type RouteState = { attempt: number };

export const AUTO_PROVIDER = "oh-my-pi";
export const AUTO_MODEL_ID = "auto";

export interface RouterSettings {
	defaultRef: string;
	fastRef: string;
	fallbackRefs: string[];
}

export function splitRefs(raw: string): string[] {
	return raw
		.split(/[,\n]/)
		.map((ref) => ref.trim())
		.filter(Boolean);
}

export function resolveModelRef(ctx: ExtensionContext, ref: string): Model | undefined {
	const trimmed = ref.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash === trimmed.length - 1) return undefined;
	return ctx.modelRegistry.find(trimmed.slice(0, slash), trimmed.slice(slash + 1));
}

function pick(
	ctx: ExtensionContext,
	refs: (string | undefined)[],
	fallback: Model | undefined,
): Model | undefined {
	for (const ref of refs) {
		if (!ref) continue;
		const model = resolveModelRef(ctx, ref);
		if (model) return model;
	}
	return fallback;
}

export function pickRouteModel(
	ctx: ExtensionContext,
	settings: RouterSettings,
	request: RouteRequest,
): Model | undefined {
	const sessionModel = ctx.model;
	if (request.reason === "retry") {
		const attempt = ((request.state as RouteState | undefined)?.attempt ?? 0) + 1;
		const fallback = settings.fallbackRefs[attempt - 1];
		return (
			(fallback ? resolveModelRef(ctx, fallback) : undefined) ??
			request.previous?.model ??
			pick(ctx, [settings.defaultRef], sessionModel)
		);
	}
	if (request.reason === "continuation") {
		return request.previous?.model ?? pick(ctx, [settings.defaultRef], sessionModel);
	}
	if (request.reason === "direct") {
		return pick(ctx, [settings.fastRef, settings.defaultRef], sessionModel);
	}
	return pick(ctx, [settings.defaultRef], sessionModel);
}

export function registerAutoRouter(pi: ExtensionAPI, settings: RouterSettings): void {
	pi.registerVirtualModel<RouteState>({
		provider: AUTO_PROVIDER,
		id: AUTO_MODEL_ID,
		name: "Auto (oh-my-pi)",
		thinkingLevels: ["off", "low", "medium", "high"],
		route(request, ctx) {
			const model = pickRouteModel(ctx, settings, request);
			if (!model) throw new Error("oh-my-pi: no model available for the auto router");
			const attempt =
				request.reason === "retry"
					? ((request.state as RouteState | undefined)?.attempt ?? 0) + 1
					: 0;
			return { model, thinkingLevel: request.thinkingLevel, state: { attempt } };
		},
	});
}
