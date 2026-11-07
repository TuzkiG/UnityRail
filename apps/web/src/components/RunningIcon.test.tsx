import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RunningIcon } from "./RunningIcon";

test("running icon is the store-free, labeled, theme-coloured rail-border cube with split frame", () => {
	const markup = renderToStaticMarkup(<RunningIcon className="size-14 text-primary" />);

	expect(markup).toContain('aria-label="Agent working"');
	expect(markup).toContain('data-testid="running-icon"');
	expect(markup).toContain('data-running="true"');
	expect(markup).toContain("size-14 text-primary");
	expect(markup.match(/motion-safe:animate-loader-frame/g)).toHaveLength(5);
	expect(markup).not.toMatch(/animate-loader-(t-bar|r-bowl|r-tail)/);
	expect(markup.match(/data-testid="running-icon-rail"/g)).toHaveLength(3);
	expect(markup.match(/stroke-dasharray="1000 1000"/g)).toHaveLength(5);
	expect(markup).not.toMatch(/stroke-dashoffset/);
	expect(markup).not.toContain("motion-reduce:");
	expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/i);
	expect(markup).not.toContain("Needs attention");
});

test("both border rails draw and erase on the working cycle, and the spokes link them to the cube", () => {
	const markup = renderToStaticMarkup(<RunningIcon />);

	expect(markup.match(/stroke="currentColor"/g)).toHaveLength(3);
	expect(markup).toContain(
		'd="M512 123.92 L890 317.96 L890 706.04 L512 900.08 L134 706.04 L134 317.96 Z"',
	);
	expect(markup).toContain(
		'd="M512 240.96 L776 376.48 L776 647.52 L512 783.04 L248 647.52 L248 376.48 Z"',
	);
	expect(markup).toContain('d="M248 376.48 L512 512 L776 376.48 M512 512 L512 783.04"');
	expect(markup).not.toContain("running-icon-ties");
});
