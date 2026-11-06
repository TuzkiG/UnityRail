import { expect, test } from "bun:test";
import { testFrames } from "./verifyFrames";

test("Unity stack frames are read from the `in <path>.cs:<line>` form", () => {
	const frames = testFrames(
		[
			"UnityEngine.Debug:LogError (object)",
			"Player.Update () (at Assets/Scripts/Player.cs:42)",
			"at Game.Enemy.Tick () [0x00000] in Assets/Scripts/Enemy.cs:17",
		].join("\n"),
	);
	expect(frames).toEqual([
		{ path: "Assets/Scripts/Player.cs", line: 42 },
		{ path: "Assets/Scripts/Enemy.cs", line: 17 },
	]);
});

test("frames without a script path, without a line, or duplicated are dropped", () => {
	expect(testFrames(undefined)).toEqual([]);
	expect(testFrames("at System.Object:Method ()")).toEqual([]);
	expect(testFrames("Assets/Scripts/Player.cs:not-a-line")).toEqual([]);
	expect(
		testFrames(
			"Assets/Scripts/Player.cs:7\nAssets/Scripts/Player.cs:7\nAssets/Scripts/Player.cs:9",
		),
	).toEqual([
		{ path: "Assets/Scripts/Player.cs", line: 7 },
		{ path: "Assets/Scripts/Player.cs", line: 9 },
	]);
});

test("a Windows-absolute frame keeps its path for workspace resolution", () => {
	expect(testFrames("at X () in C:\\Game\\Assets\\Scripts\\Player.cs:12")).toEqual([
		{ path: "C:\\Game\\Assets\\Scripts\\Player.cs", line: 12 },
	]);
});
