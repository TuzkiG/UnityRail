// One-off generator for the UnityRail brand mark: a hollow isometric cube whose border is a rail track —
// two concentric hexagonal rails, with the cube's three inner edges as spokes. Flat in one brand green on
// the black tile, like the original ThinkRail icon.
//
// Run with `bun packages/shared/scripts/generate-brand-mark.ts`, then
// `bun run --cwd packages/shared generate-icons` for the rasters.
import { writeFileSync } from "node:fs";

const CENTER = 512;
const HALF_WIDTH = 300;
const HALF_HEIGHT = 308;

const APEX = [CENTER, CENTER - HALF_HEIGHT] as const;
const UPPER_RIGHT = [CENTER + HALF_WIDTH, CENTER - 154] as const;
const LOWER_RIGHT = [CENTER + HALF_WIDTH, CENTER + 154] as const;
const BOTTOM = [CENTER, CENTER + HALF_HEIGHT] as const;
const LOWER_LEFT = [CENTER - HALF_WIDTH, CENTER + 154] as const;
const UPPER_LEFT = [CENTER - HALF_WIDTH, CENTER - 154] as const;
const HEXAGON = [APEX, UPPER_RIGHT, LOWER_RIGHT, BOTTOM, LOWER_LEFT, UPPER_LEFT];

/** Centrelines: the outer rail rides `OUTER_SCALE`, the inner one `INNER_SCALE`, both about the centre. */
const OUTER_SCALE = 1.04;
const INNER_SCALE = 0.56;
const RAIL = 56;

type Point = readonly [number, number];
const round = (n: number) => Math.round(n * 100) / 100;
const at = (scale: number, [x, y]: Point): Point => [
	round(CENTER + (x - CENTER) * scale),
	round(CENTER + (y - CENTER) * scale),
];
const xy = ([x, y]: Point) => `${x} ${y}`;
const ring = (scale: number) =>
	`${HEXAGON.map((v) => at(scale, v))
		.map((v, i) => `${i === 0 ? "M" : "L"}${xy(v)}`)
		.join(" ")} Z`;

const OUTER_RAIL = ring(OUTER_SCALE);
const INNER_RAIL = ring(INNER_SCALE);
const SPOKES = `M${xy(at(INNER_SCALE, UPPER_LEFT))} L${xy([CENTER, CENTER])} L${xy(at(INNER_SCALE, UPPER_RIGHT))} M${xy([CENTER, CENTER])} L${xy(at(INNER_SCALE, BOTTOM))}`;

const TILE = "#000000";
const ACCENT = "#8dff4f";

const mark = (
	color: string,
) => `	<g fill="none" stroke="${color}" stroke-linejoin="round" stroke-linecap="round">
		<path d="${OUTER_RAIL}" stroke-width="${RAIL}" />
		<path d="${INNER_RAIL}" stroke-width="${RAIL}" />
		<path d="${SPOKES}" stroke-width="${RAIL}" />
	</g>`;

const colorIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
	<title>UnityRail</title>
	<rect width="1024" height="1024" rx="224" fill="${TILE}" />
${mark(ACCENT)}
</svg>
`;

const monochrome = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
	<title>UnityRail</title>
	<style>
		:root { color: ${TILE}; }
		@media (prefers-color-scheme: dark) { :root { color: #f4f7f2; } }
	</style>
${mark("currentColor")}
</svg>
`;

writeFileSync("packages/shared/assets/icon.svg", colorIcon);
writeFileSync("apps/web/public/favicon.svg", monochrome);
writeFileSync("apps/website/public/favicon.svg", monochrome);
writeFileSync("apps/website/public/vibecoding/favicon.svg", monochrome);

console.log(
	[
		`export const BRAND_RAIL_WIDTH = ${RAIL};`,
		"",
		"export const BRAND_MARK_SEGMENTS = {",
		`\touterRail: ${JSON.stringify(OUTER_RAIL)},`,
		`\tinnerRail: ${JSON.stringify(INNER_RAIL)},`,
		`\tspokes: ${JSON.stringify(SPOKES)},`,
		"} as const;",
	].join("\n"),
);
