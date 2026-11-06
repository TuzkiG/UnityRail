import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RunningIcon } from "./RunningIcon";

test("running icon is the store-free, labeled, theme-coloured rail-border cube with a lapping frame", () => {
	const markup = renderToStaticMarkup(<RunningIcon className="size-14 text-primary" />);

	expect(markup).toContain('aria-label="Agent working"');
	expect(markup).toContain('data-testid="running-icon"');
	expect(markup).toContain('data-running="true"');
	expect(markup).toContain("size-14 text-primary");
	expect(markup).toContain("motion-safe:animate-loader-comet");
	expect(markup).toContain("motion-safe:opacity-40");
	expect(markup.match(/motion-safe:animate-/g)).toHaveLength(1);
	expect(markup.match(/data-testid="running-icon-rail"/g)).toHaveLength(3);
	expect(markup.match(/stroke-dasharray="140 860"/g)).toHaveLength(1);
	expect(markup).not.toMatch(/stroke-dashoffset/);
	expect(markup).not.toContain("motion-reduce:");
	expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/i);
	expect(markup).not.toContain("Needs attention");
});

test("the frame is stroked twice — dim track and travelling segment — over the still cube", () => {
	const markup = renderToStaticMarkup(<RunningIcon />);

	expect(markup.match(/stroke="currentColor"/g)).toHaveLength(3);
	expect(
		markup.match(
			/d="M110 20 H650 A90 90 0 0 1 740 110 V650 A90 90 0 0 1 650 740 H110 A90 90 0 0 1 20 650 V110 A90 90 0 0 1 110 20 Z"/g,
		),
	).toHaveLength(2);
	expect(markup).toContain(
		'd="M512 123.92 L890 317.96 L890 706.04 L512 900.08 L134 706.04 L134 317.96 Z"',
	);
	expect(markup).toContain(
		'd="M512 240.96 L776 376.48 L776 647.52 L512 783.04 L248 647.52 L248 376.48 Z"',
	);
	expect(markup).toContain('d="M248 376.48 L512 512 L776 376.48 M512 512 L512 783.04"');
	expect(markup).not.toContain("running-icon-ties");
});
