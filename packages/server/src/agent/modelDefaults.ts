import type { WireModel } from "@thinkrail/contracts";
import { createPiSettings } from "./packages";

/** pi's API id for catalog entries a router resolves before dispatch; not re-exported from the package root. */
export const VIRTUAL_MODEL_API = "pi-virtual";

/** The two shapes a selection sees: pi's `Model` (its `api`) or the wire model (its `virtual` flag). */
type Routed = { api?: string; virtual?: true };

/** A routed model has no provider of its own and must never be a default or a one-shot target. */
export function isVirtualModel(model: Routed): boolean {
	return model.virtual === true || model.api === VIRTUAL_MODEL_API;
}

export const PI_DEFAULT_MODEL_PER_PROVIDER: Readonly<Record<string, string>> = {
	"amazon-bedrock": "us.anthropic.claude-opus-5-5",
	"ant-ling": "Ring-2.6-1T",
	anthropic: "claude-opus-5-5",
	openai: "gpt-6.1-sol",
	azure: "gpt-6.1-sol",
	"openai-codex": "gpt-6.1-sol",
	radius: "balanced",
	nvidia: "nvidia/nemotron-3.5-super-vl-120b-a12b",
	deepseek: "deepseek-v4-pro",
	google: "gemini-4-argon",
	"google-vertex": "gemini-4-argon",
	"github-copilot": "gpt-6.1-sol",
	openrouter: "moonshotai/kimi-k2.7-code",
	"vercel-ai-gateway": "zai/glm-5.3",
	xai: "grok-4.7",
	groq: "openai/gpt-oss-120b",
	cerebras: "gpt-oss-120b",
	zai: "glm-5.3",
	"zai-coding-cn": "glm-5.3",
	mistral: "devstral-medium-latest",
	minimax: "MiniMax-M3",
	"minimax-cn": "MiniMax-M3",
	moonshotai: "kimi-k2.7-code",
	"moonshotai-cn": "kimi-k2.7-code",
	huggingface: "moonshotai/Kimi-K2.7-Code",
	fireworks: "accounts/fireworks/models/kimi-k3",
	together: "moonshotai/Kimi-K3",
	baseten: "zai-org/GLM-5.3",
	opencode: "kimi-k2.7-code",
	"opencode-go": "kimi-k3.1-pro",
	"kimi-coding": "kimi-for-coding",
	meta: "muse-spark-1.3",
	"cloudflare-workers-ai": "@cf/moonshotai/kimi-k2.7-code",
	"cloudflare-ai-gateway": "workers-ai/@cf/moonshotai/kimi-k2.7-code",
	"qwen-token-plan": "qwen3.8-max",
	"qwen-token-plan-cn": "qwen3.8-max",
	"qwen-token-plan-individual": "qwen3.8-max",
	"qwen-token-plan-individual-cn": "qwen3.8-max",
	xiaomi: "mimo-v2.6-pro",
	"xiaomi-token-plan-cn": "mimo-v2.6-pro",
	"xiaomi-token-plan-ams": "mimo-v2.6-pro",
	"xiaomi-token-plan-sgp": "mimo-v2.6-pro",
};

export function preferredDefaultModel<T extends Pick<WireModel, "provider" | "id"> & Routed>(
	available: readonly T[],
): T | undefined {
	const physical = available.filter((model) => !isVirtualModel(model));
	for (const [provider, id] of Object.entries(PI_DEFAULT_MODEL_PER_PROVIDER)) {
		const match = physical.find((model) => model.provider === provider && model.id === id);
		if (match) return match;
	}
	for (const id of Object.values(PI_DEFAULT_MODEL_PER_PROVIDER)) {
		const match = physical.find((model) => model.id === id);
		if (match) return match;
	}
	return physical[0];
}

/** Small models first, by family: what auxiliary work and a routed chat's execution turn use. */
const CHEAP_MODELS: ReadonlyArray<readonly [provider: string, idPrefix: string]> = [
	["anthropic", "claude-haiku"],
	["openai", "gpt-5-mini"],
	["openai", "gpt-4o-mini"],
	["openai", "gpt-4.1-mini"],
	["google", "gemini-2.5-flash"],
	["google", "gemini-flash"],
	["xai", "grok-build"],
];

type PricedModel = Pick<WireModel, "provider" | "id"> & { cost: { input: number; output: number } };

/** The cheapest available model by list price, preferring the known small families. */
export function cheapModel<T extends PricedModel>(available: readonly T[]): T | undefined {
	for (const [provider, prefix] of CHEAP_MODELS) {
		const hit = available.find(
			(model) => model.provider === provider && model.id.startsWith(prefix),
		);
		if (hit) return hit;
	}
	return available
		.filter((model) => tokenCost(model) > 0)
		.sort(
			(left, right) => tokenCost(left) - tokenCost(right) || left.id.localeCompare(right.id),
		)[0];
}

function tokenCost(model: PricedModel): number {
	return model.cost.input + model.cost.output;
}

export function piDefaultModelRef() {
	const { defaultProvider: provider, defaultModel: id } = createPiSettings(
		process.cwd(),
		undefined,
		{ projectTrusted: false, packages: "all" },
	).getGlobalSettings();
	return provider && id ? { provider, id } : undefined;
}
