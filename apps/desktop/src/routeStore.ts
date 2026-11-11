import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const ROUTE_VERSION = 1;
const FALLBACK_ROUTE = "#/v1";
const MAX_ROUTE_LENGTH = 4096;
const WRITE_DELAY_MS = 300;

interface RouteDocument {
	version: 1;
	routes: Record<string, string>;
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 31 || code === 127) return true;
	}
	return false;
}

function validRoute(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.startsWith("#") &&
		value.length <= MAX_ROUTE_LENGTH &&
		!hasControlCharacter(value)
	);
}

function readDocument(path: string): RouteDocument {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (
			typeof value !== "object" ||
			value === null ||
			Reflect.get(value, "version") !== ROUTE_VERSION ||
			typeof Reflect.get(value, "routes") !== "object" ||
			Reflect.get(value, "routes") === null
		) {
			return { version: ROUTE_VERSION, routes: {} };
		}
		const routes: Record<string, string> = {};
		for (const [key, route] of Object.entries(
			Reflect.get(value, "routes") as Record<string, unknown>,
		)) {
			if (validRoute(route)) routes[key] = route;
		}
		return { version: ROUTE_VERSION, routes };
	} catch {
		return { version: ROUTE_VERSION, routes: {} };
	}
}

export class RouteStore {
	readonly #path: string;
	readonly #document: RouteDocument;
	#dirty = false;
	#directoryReady = false;
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(path: string) {
		this.#path = path;
		this.#document = existsSync(path) ? readDocument(path) : { version: ROUTE_VERSION, routes: {} };
	}

	read(backendProfileId: string, windowId: string): string {
		return this.#document.routes[`${backendProfileId}:${windowId}`] ?? FALLBACK_ROUTE;
	}

	write(backendProfileId: string, windowId: string, route: unknown): boolean {
		if (!validRoute(route)) return false;
		const key = `${backendProfileId}:${windowId}`;
		if (this.#document.routes[key] === route) return true;
		this.#document.routes[key] = route;
		this.#dirty = true;
		this.#scheduleFlush();
		return true;
	}

	flush(): void {
		if (this.#timer !== undefined) {
			clearTimeout(this.#timer);
			this.#timer = undefined;
		}
		if (!this.#dirty) return;
		this.#dirty = false;
		if (!this.#directoryReady) {
			mkdirSync(dirname(this.#path), { recursive: true });
			this.#directoryReady = true;
		}
		writeFileSync(this.#path, `${JSON.stringify(this.#document, null, "\t")}\n`);
	}

	#scheduleFlush(): void {
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			this.flush();
		}, WRITE_DELAY_MS);
	}
}
