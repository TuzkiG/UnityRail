import { expect, test } from "bun:test";
import { createChatStreams } from "@/lib/chatHighlighter";
import { highlightedLines } from "./highlightedLines";

const HTML =
	'<pre class="shiki thinkrail-css-variables" style="color:var(--code-foreground)"><code><span class="line"><span style="color:var(--code-keyword)">const</span> a = 1;</span>\n<span class="line"></span>\n<span class="line">b</span></code></pre>';

test("splits shiki html into one snippet per line", () => {
	expect(highlightedLines(HTML)).toEqual([
		'<span class="line"><span style="color:var(--code-keyword)">const</span> a = 1;</span>',
		'<span class="line"></span>',
		'<span class="line">b</span>',
	]);
});

test("html without a code body yields nothing", () => {
	expect(highlightedLines("plain text")).toEqual([]);
	expect(highlightedLines("<pre><code></code></pre>")).toEqual([""]);
});

test("real highlighted html yields one snippet per input line", async () => {
	const streams = createChatStreams();
	const code = "public class A\n{\n    void F() { }\n}";
	const result = streams.highlight("test", code, "csharp");
	const html = result && "html" in result ? result.html : null;
	expect(html).not.toBeNull();
	const lines = highlightedLines(html ?? "");
	expect(lines).toHaveLength(code.split("\n").length);
	expect(lines[0]).toContain("var(--code-");
}, 20_000);
