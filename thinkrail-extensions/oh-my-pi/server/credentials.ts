import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

type Model = Parameters<ModelRegistry["complete"]>[0];
type Context = Parameters<ModelRegistry["complete"]>[1];
type Options = NonNullable<Parameters<ModelRegistry["complete"]>[2]>;

export interface CredentialPool {
	keys: Map<string, string[]>;
	bad: Set<string>;
}

const ROTATION_STATUS = new Set([401, 429]);

export function modelKey(model: Pick<Model, "provider" | "id">): string {
	return `${model.provider}/${model.id}`;
}

export function parseApiKeys(raw: string): CredentialPool {
	const keys = new Map<string, string[]>();
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const equals = trimmed.indexOf("=");
		if (equals <= 0) continue;
		const target = trimmed.slice(0, equals).trim();
		const parsed = trimmed
			.slice(equals + 1)
			.split(/[|,]/)
			.map((key) => key.trim())
			.filter(Boolean);
		if (!target || parsed.length === 0) continue;
		const existing = keys.get(target) ?? [];
		keys.set(target, [...new Set([...existing, ...parsed])]);
	}
	return { keys, bad: new Set() };
}

export function apiKeyFor(
	pool: CredentialPool,
	model: Pick<Model, "provider" | "id">,
): string | undefined {
	const target = modelKey(model);
	return pool.keys.get(target)?.find((key) => !pool.bad.has(`${target}\u0000${key}`));
}

export function markApiKeyBad(
	pool: CredentialPool,
	model: Pick<Model, "provider" | "id">,
	key: string,
): void {
	pool.bad.add(`${modelKey(model)}\u0000${key}`);
}

export function isRotationError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const status =
		(error as { status?: unknown; statusCode?: unknown }).status ??
		(error as { statusCode?: unknown }).statusCode;
	if (typeof status === "number" && ROTATION_STATUS.has(status)) return true;
	const message = (error as { message?: unknown }).message;
	return typeof message === "string" && /(?:\b401\b|\b429\b)/.test(message);
}

export async function completeWithRotation(
	registry: ModelRegistry,
	pool: CredentialPool | undefined,
	model: Model,
	context: Context,
	options: Options,
): Promise<Awaited<ReturnType<ModelRegistry["complete"]>>> {
	let key = pool ? apiKeyFor(pool, model) : undefined;
	for (let attempt = 0; ; attempt++) {
		try {
			return await registry.complete(model, context, key ? { ...options, apiKey: key } : options);
		} catch (error) {
			if (!pool || !key || attempt >= 9 || !isRotationError(error)) throw error;
			markApiKeyBad(pool, model, key);
			const next = apiKeyFor(pool, model);
			if (!next) throw error;
			key = next;
		}
	}
}
