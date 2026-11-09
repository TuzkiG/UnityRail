import { expect, test } from "bun:test";
import { ansiSpans } from "./ansiSpans";

test("plain text is one untoned span", () => {
	expect(ansiSpans("hello\nworld")).toEqual([{ text: "hello\nworld", tone: null }]);
});

test("SGR foreground colors open and close a span", () => {
	expect(ansiSpans("\u001b[31mred\u001b[39mplain")).toEqual([
		{ text: "red", tone: "red" },
		{ text: "plain", tone: null },
	]);
});

test("bright colors and resets inside one sequence", () => {
	expect(ansiSpans("\u001b[1;92mok\u001b[0m!")).toEqual([
		{ text: "ok", tone: "brightGreen" },
		{ text: "!", tone: null },
	]);
});

test("non-SGR escapes are dropped, never rendered", () => {
	expect(ansiSpans("a\u001b[2Jb\u001b[?25lc")).toEqual([{ text: "abc", tone: null }]);
});

test("an unterminated escape is dropped", () => {
	expect(ansiSpans("a\u001b[31")).toEqual([{ text: "a31", tone: null }]);
});
