import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RunningIcon } from "./RunningIcon";

test("running icon is the store-free, labeled, theme-coloured rail-border cube with split frame", () => {
	const markup = renderToStaticMarkup(<RunningIcon className="size-14 text-primary" />);

	expect(markup).toContain('aria-label="Agent working"');
	expect(markup).toContain('data-testid="running-icon"');
	expect(markup).toContain('data-running="true"');
	expect(markup).toContain("size-14 text-primary");
	for (const cls of ["loader-t-bar", "loader-r-bowl", "loader-r-tail"])
		expect(markup).toContain(`motion-safe:animate-${cls}`);
	expect(markup.match(/motion-safe:animate-loader-frame/g)).toHaveLength(2);
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
		'd="M512 191.68 L824 351.84 L824 672.16 L512 832.32 L200 672.16 L200 351.84 Z"',
	);
	expect(markup).toContain(
		'd="M512 339.52 L680 425.76 L680 598.24 L512 684.48 L344 598.24 L344 425.76 Z"',
	);
	expect(markup).toContain('d="M344 425.76 L512 512 L680 425.76 M512 512 L512 684.48"');
	expect(markup).not.toContain("running-icon-ties");
});
