import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MemoryOptions } from "./options.ts";

// The adapter reads MEMORY_URL / MEMORY_PORT / MEMORY_BIN at its module scope, so the process
// environment is set before the first import and the first import is cached; later sessions reuse
// the same adapter instance (its project binding follows the first session that initializes it —
// see SPEC). The adapter's auto-spawn of the Memory server and its self-heal stay as shipped.
// The package ships raw TypeScript with no declaration files, so the import uses a variable
// specifier: the module stays untyped here instead of being checked under this repo's settings.
interface MemoryAdapterModule {
	default: (pi: ExtensionAPI) => void;
}

let adapterPromise: Promise<MemoryAdapterModule> | undefined;

function applyEnvironment(options: MemoryOptions): void {
	if (options.memoryUrl) process.env.MEMORY_URL = options.memoryUrl;
	if (options.memoryPort) process.env.MEMORY_PORT = options.memoryPort;
	if (options.memoryBin) process.env.MEMORY_BIN = options.memoryBin;
}

/** Registers the Memory adapter's tools and hooks on this session's pi. */
export async function registerMemoryAdapter(
	pi: ExtensionAPI,
	options: MemoryOptions,
): Promise<void> {
	adapterPromise ??= (async () => {
		applyEnvironment(options);
		const specifier = "@cloudfrog/memory";
		return import(specifier);
	})();
	const { default: register } = await adapterPromise;
	register(pi);
}
