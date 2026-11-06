import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BRAND_RAIL_TIES } from "../constants/branding";
import { RunningIcon } from "./RunningIcon";

test("running icon is the store-free, labeled, theme-coloured rail-border cube with split frame", () => {
	const markup = renderToStaticMarkup(<RunningIcon className="size-14 text-primary" />);

	expect(markup).toContain('aria-label="Agent working"');
	expect(markup).toContain('data-testid="running-icon"');
	expect(markup).toContain('data-running="true"');
	expect(markup).toContain("size-14 text-primary");
	for (const cls of ["loader-t-bar", "loader-r-bowl", "loader-r-tail", "loader-ties"])
		expect(markup).toContain(`motion-safe:animate-${cls}`);
	expect(markup.match(/motion-safe:animate-loader-frame/g)).toHaveLength(2);
	expect(markup.match(/data-testid="running-icon-rail"/g)).toHaveLength(3);
	expect(markup.match(/stroke-dasharray="1000 1000"/g)).toHaveLength(5);
	expect(markup).not.toMatch(/stroke-dashoffset/);
	expect(markup).not.toContain("motion-reduce:");
	expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/i);
	expect(markup).not.toContain("Needs attention");
});

test("both border rails draw and erase on the working cycle, and every tie rides the mark's own rungs", () => {
	const markup = renderToStaticMarkup(<RunningIcon />);

	expect(markup.match(/stroke="currentColor"/g)).toHaveLength(4);
	expect(markup).toContain(
		'd="M512 234.8 L782 373.4 L782 650.6 L512 789.2 L242 650.6 L242 373.4 Z"',
	);
	expect(markup).toContain(
		'd="M512 327.2 L692 419.6 L692 604.4 L512 696.8 L332 604.4 L332 419.6 Z"',
	);
	expect(markup).toContain('d="M332 419.6 L512 512 L692 419.6 M512 512 L512 696.8"');
	for (const tie of BRAND_RAIL_TIES) expect(markup).toContain(`d="${tie}"`);
});
