export interface ScopedCache<T> {
	peek(scope: string): T | null;
	set(scope: string, value: T): void;
	forget(scope: string): void;
}

/** A small LRU for settings reads that should survive closing and reopening their page. */
export function createScopedCache<T>(size = 8): ScopedCache<T> {
	const entries = new Map<string, T>();
	return {
		peek(scope) {
			const value = entries.get(scope);
			if (value === undefined) return null;
			entries.delete(scope);
			entries.set(scope, value);
			return value;
		},
		set(scope, value) {
			entries.delete(scope);
			entries.set(scope, value);
			for (const oldest of entries.keys()) {
				if (entries.size <= size) break;
				entries.delete(oldest);
			}
		},
		forget(scope) {
			entries.delete(scope);
		},
	};
}
