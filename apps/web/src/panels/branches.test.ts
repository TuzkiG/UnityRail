import { expect, mock, test } from "bun:test";
import type { BranchList } from "@thinkrail/contracts";

type Reply = { resolve: (list: BranchList) => void; reject: (error: unknown) => void };
const calls: Array<{ params: unknown; reply: Reply }> = [];
const actualTransport = await import("../transport");
mock.module("../transport", () => ({
	...actualTransport,
	getTransport: () => ({
		request: (_method: string, params: unknown) =>
			new Promise<BranchList>((resolve, reject) => {
				calls.push({ params, reply: { resolve, reject } });
			}),
	}),
}));

const { BRANCH_LIST_TTL_MS, branchListIsFresh, peekBranchList, readBranchList } = await import(
	"./branches"
);

const list = (defaultBranch: string): BranchList => ({
	local: [defaultBranch],
	remote: [],
	defaultBranch,
});

async function read(
	projectId: string,
	options: { workspaceId?: string; repo?: string } = {},
	answer: BranchList = list("main"),
) {
	const done = readBranchList(projectId, options);
	calls.shift()?.reply.resolve(answer);
	return done;
}

test("a branch read is cached per project, workspace and repository", async () => {
	await read("p-key", { workspaceId: "w-key", repo: "" });
	expect(peekBranchList("p-key", { workspaceId: "w-key", repo: "" })?.list.defaultBranch).toBe(
		"main",
	);
	expect(peekBranchList("p-key", { workspaceId: "w-other", repo: "" })).toBeNull();
	expect(peekBranchList("p-key", { workspaceId: "w-key", repo: "nested" })).toBeNull();
	expect(peekBranchList("p-other", { workspaceId: "w-key", repo: "" })).toBeNull();
});

test("concurrent reads of one branch list share a single request", async () => {
	const first = readBranchList("p-share", { workspaceId: "w-share" });
	const second = readBranchList("p-share", { workspaceId: "w-share" });
	expect(calls).toHaveLength(1);
	calls.shift()?.reply.resolve(list("develop"));
	const [one, two] = await Promise.all([first, second]);
	expect(two).toBe(one as BranchList);
});

test("a failed read is not cached, so the next mount reads again", async () => {
	const failed = readBranchList("p-fail", {});
	calls.shift()?.reply.reject(new Error("offline"));
	expect(await failed).toBeNull();
	expect(peekBranchList("p-fail", {})).toBeNull();
	await read("p-fail", {}, list("release"));
	expect(peekBranchList("p-fail", {})?.list.defaultBranch).toBe("release");
});

test("a cached list is fresh only for its TTL", async () => {
	await read("p-ttl", {}, list("main"));
	const cached = peekBranchList("p-ttl", {});
	if (!cached) throw new Error("missing cached branch list");
	expect(branchListIsFresh(cached, cached.at + BRANCH_LIST_TTL_MS - 1)).toBe(true);
	expect(branchListIsFresh(cached, cached.at + BRANCH_LIST_TTL_MS)).toBe(false);
	expect(branchListIsFresh(null)).toBe(false);
});
