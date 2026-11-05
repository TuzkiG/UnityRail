import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RunningIcon } from "./RunningIcon";

test("running icon is the store-free, labeled, theme-coloured stroke-drawn cube-and-rail mark with split frame", () => {
	const markup = renderToStaticMarkup(<RunningIcon className="size-14 text-primary" />);

	expect(markup).toContain('aria-label="Agent working"');
	expect(markup).toContain('data-testid="running-icon"');
	expect(markup).toContain('data-running="true"');
	expect(markup).toContain("size-14 text-primary");
	for (const cls of [
		"loader-t-bar",
		"loader-t-stem",
		"loader-r-tail",
		"loader-r-bowl",
		"loader-r-leg",
	])
		expect(markup).toContain(`motion-safe:animate-${cls}`);
	expect(markup.match(/motion-safe:animate-loader-frame/g)).toHaveLength(2);
	expect(markup.match(/stroke="currentColor"/g)).toHaveLength(7);
	expect(markup.match(/stroke-dasharray="1000 1000"/g)).toHaveLength(7);
	expect(markup).not.toMatch(/stroke-dashoffset/);
	expect(markup).not.toContain("motion-reduce:");
	expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b|style="/i);
	expect(markup).not.toContain("Needs attention");
});

test("running icon draws the cube faces and both rails from the mark's own geometry", () => {
	const markup = renderToStaticMarkup(<RunningIcon />);
	expect(markup).toContain('d="M512 116 L812 270 L512 424 L212 270 Z"');
	expect(markup).toContain('d="M212 270 L512 424 L512 732 L212 578 Z"');
	expect(markup).toContain('d="M812 270 L512 424 L512 732 L812 578 Z"');
	expect(markup).toContain('d="M358 668 L512 436"');
	expect(markup).toContain('d="M666 668 L512 436"');
});
