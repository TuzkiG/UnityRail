import type { MessageKey } from "@thinkrail/locales";
import type { MemoryString, MemoryToggle } from "../shared/keys";

export {
	MEMORY_EXTENSION,
	MEMORY_FIELDS,
	MEMORY_STRINGS,
	MEMORY_TOGGLES,
	type MemoryString,
	type MemoryToggle,
} from "../shared/keys";

interface ToggleCopy {
	title: MessageKey;
	description: MessageKey;
}

interface FieldCopy extends ToggleCopy {
	placeholder: MessageKey;
}

/** Total by key: adding a toggle or string to `shared/keys.ts` without copy fails the typecheck. */
export const MEMORY_TOGGLE_COPY = {
	enabled: {
		title: "settings.memory.enabled.title",
		description: "settings.memory.enabled.description",
	},
} satisfies Record<MemoryToggle, ToggleCopy>;

export const MEMORY_FIELD_COPY = {
	memoryBin: {
		title: "settings.memory.memoryBin.title",
		description: "settings.memory.memoryBin.description",
		placeholder: "settings.memory.memoryBin.placeholder",
	},
	memoryPort: {
		title: "settings.memory.memoryPort.title",
		description: "settings.memory.memoryPort.description",
		placeholder: "settings.memory.memoryPort.placeholder",
	},
	memoryUrl: {
		title: "settings.memory.memoryUrl.title",
		description: "settings.memory.memoryUrl.description",
		placeholder: "settings.memory.memoryUrl.placeholder",
	},
} satisfies Record<MemoryString, FieldCopy>;
