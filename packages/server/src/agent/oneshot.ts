import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { usePiRuntime } from "./agentSessionManager";
import { cheapModel, preferredDefaultModel } from "./modelDefaults";
import { type AvailableModelsRuntime, settledAvailableModels } from "./piRuntime";

export type ModelTier = "cheap" | "default";

export interface OneShotRequest {
	system?: string;
	prompt: string;
	tier?: ModelTier;
	maxTokens?: number;
	temperature?: number;
	signal?: AbortSignal;
}

export interface OneShotResult {
	text: string;
	model: { provider: string; id: string };
}

function pickModelFromRuntime(runtime: AvailableModelsRuntime, tier: ModelTier): Model<Api> | null {
	const available = settledAvailableModels(runtime);
	if (available.length === 0) return null;
	if (tier === "default") return preferredDefaultModel(available) ?? null;
	return cheapModel(available) ?? preferredDefaultModel(available) ?? null;
}

export function pickModel(tier: ModelTier = "cheap"): Promise<Model<Api> | null> {
	return usePiRuntime((runtime) => pickModelFromRuntime(runtime, tier));
}

export function completeOnce(req: OneShotRequest): Promise<OneShotResult> {
	return usePiRuntime(async (runtime) => {
		const model = pickModelFromRuntime(runtime, req.tier ?? "cheap");
		if (!model) throw new Error("no-model");

		const context: Context = {
			...(req.system ? { systemPrompt: req.system } : {}),
			messages: [{ role: "user", content: req.prompt, timestamp: Date.now() }],
		};
		const message = await runtime.completeSimple(model, context, {
			maxTokens: req.maxTokens ?? 256,
			temperature: req.temperature ?? 0.2,
			...(req.signal ? { signal: req.signal } : {}),
		});

		const text = message.content
			.filter((content) => content.type === "text")
			.map((content) => content.text)
			.join("")
			.trim();
		return { text, model: { provider: String(model.provider), id: model.id } };
	});
}
