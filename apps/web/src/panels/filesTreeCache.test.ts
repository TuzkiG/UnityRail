import { expect, test } from "bun:test";
import type { FileNode } from "@thinkrail/contracts";
import { useAppStore } from "../store";
import {
	FILES_TREE_CACHE_SIZE,
	peekFolderChain,
	peekRootDir,
	readFolderChain,
	readRootDir,
} from "./filesTreeCache";
import type { ResolvedFolderChain } from "./folderChains";

const file = (path: string): FileNode => ({ path, name: path, kind: "file" });
const chain = (path: string): ResolvedFolderChain<FileNode> => ({
	label: path,
	path,
	paths: [path],
	deepest: { path, name: path, kind: "dir" },
	children: [file(`${path}/a.ts`)],
});

test("a root listing is cached per workspace and repository", async () => {
	await readRootDir("ft-root", "apps", async () => [file("apps/a.ts")]);
	expect(peekRootDir("ft-root", "apps")?.[0]?.path).toBe("apps/a.ts");
	expect(peekRootDir("ft-root", "")).toBeNull();
	expect(peekRootDir("ft-other", "apps")).toBeNull();
});

test("a folder chain is cached per workspace, repository and starting path", async () => {
	const resolved = chain("apps/web");
	await readFolderChain("ft-chain", "", "apps", async () => resolved);
	expect(peekFolderChain("ft-chain", "", "apps")).toBe(resolved);
	expect(peekFolderChain("ft-chain", "", "docs")).toBeNull();
	expect(peekFolderChain("ft-chain", "nested", "apps")).toBeNull();
});

test("concurrent reads of one listing share a single request", async () => {
	let reads = 0;
	const pending = Promise.withResolvers<FileNode[]>();
	const first = readRootDir("ft-share", "", () => {
		reads += 1;
		return pending.promise;
	});
	const second = readRootDir("ft-share", "", () => {
		reads += 1;
		return Promise.resolve([]);
	});
	expect(reads).toBe(1);
	pending.resolve([file("shared.ts")]);
	expect(await second).toBe(await first);
});

test("a failed listing is not cached, so the next attempt reads again", async () => {
	let reads = 0;
	const read = () => {
		reads += 1;
		return Promise.reject(new Error("offline"));
	};
	await expect(readRootDir("ft-failed", "", read)).rejects.toThrow("offline");
	expect(peekRootDir("ft-failed", "")).toBeNull();
	await expect(readRootDir("ft-failed", "", read)).rejects.toThrow("offline");
	expect(reads).toBe(2);
});

test("the cache keeps only the most recently used listings", async () => {
	for (let index = 0; index < FILES_TREE_CACHE_SIZE; index += 1) {
		await readRootDir(`ft-lru-${index}`, "", async () => [file(`${index}.ts`)]);
	}
	await readRootDir("ft-lru-overflow", "", async () => []);
	expect(peekRootDir("ft-lru-0", "")).toBeNull();
	expect(peekRootDir("ft-lru-overflow", "")).not.toBeNull();
});

test("removing a workspace drops its listings and chains", async () => {
	await readRootDir("ft-gone", "", async () => [file("gone.ts")]);
	await readFolderChain("ft-gone", "", "src", async () => chain("src"));
	const previous = useAppStore.getState().removedWorkspaceIds;
	useAppStore.setState({ removedWorkspaceIds: { ...previous, "ft-gone": true } });
	expect(peekRootDir("ft-gone", "")).toBeNull();
	expect(peekFolderChain("ft-gone", "", "src")).toBeNull();
	useAppStore.setState({ removedWorkspaceIds: previous });
});
