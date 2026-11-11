export const MEMORY_EXTENSION = "memory";

export const MEMORY_TOGGLES = {
	enabled: true,
} as const;

export type MemoryToggle = keyof typeof MEMORY_TOGGLES;

export const MEMORY_STRINGS = {
	memoryBin: "memory",
	memoryPort: "6366",
	memoryUrl: "",
} as const;

export type MemoryString = keyof typeof MEMORY_STRINGS;

/** Which string setting renders under which switch; the panel iterates this, never its own copy. */
export const MEMORY_FIELDS: Record<MemoryToggle, readonly MemoryString[]> = {
	enabled: ["memoryUrl", "memoryPort", "memoryBin"],
};
