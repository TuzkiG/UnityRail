import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	clearUnityProjectCaches,
	createDirectoryLink,
	linkExists,
	listDirectoryLinks,
	moduleMountPath,
	removeDirectoryLink,
} from "./index.ts";
import { createUnityFixture } from "./test/fixture.ts";

const fixtures: Array<{ cleanup: () => void }> = [];

afterEach(() => {
	for (const fixture of fixtures.splice(0)) fixture.cleanup();
	clearUnityProjectCaches();
});

function fixture() {
	const created = createUnityFixture();
	fixtures.push(created);
	return created;
}

describe("Unity directory links", () => {
	test("mounts an external folder under Assets and reports it as an external connection", () => {
		const created = fixture();
		const source = join(created.root, "..", `${created.root.length}-business`, "Game");
		mkdirSync(source, { recursive: true });
		writeFileSync(join(source, "Game.cs"), "class Game {}\n");

		const mountPath = moduleMountPath(created.root, "Game");
		expect(linkExists(mountPath)).toBe(false);
		createDirectoryLink(source, mountPath);

		expect(linkExists(mountPath)).toBe(true);
		const links = listDirectoryLinks(created.root);
		const link = links.find((entry) => entry.name === "Game");
		expect(link).toBeDefined();
		expect(link?.target).toBe(realpathSync(source));
		expect(link?.type === "junction" || link?.type === "symlink").toBe(true);

		expect(removeDirectoryLink(mountPath)).toBe(true);
		expect(linkExists(mountPath)).toBe(false);
		// The external folder survives removing the link.
		expect(linkExists(join(source, "Game.cs"))).toBe(true);
	});

	test("refuses to mount over an existing project folder", () => {
		const created = fixture();
		const source = join(created.root, "..", `${created.root.length}-business2`, "Shared");
		mkdirSync(source, { recursive: true });
		mkdirSync(join(created.root, "Assets", "Shared"), { recursive: true });

		expect(() => createDirectoryLink(source, moduleMountPath(created.root, "Shared"))).toThrow(
			/already exists/,
		);
	});

	test("keeps the mount name inside the project", () => {
		const created = fixture();
		const mountPath = moduleMountPath(created.root, "../escape");
		expect(mountPath.startsWith(join(created.root, "Assets"))).toBe(true);
		expect(mountPath.includes("..")).toBe(false);
	});
});
