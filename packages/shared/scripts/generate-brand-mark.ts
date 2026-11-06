// One-off generator for the UnityRail brand mark: a hollow isometric cube whose border is a rail track —
// two concentric hexagonal rails joined by ties, with the cube's three inner edges as spokes. Flat in one
// brand green on the black tile, like the original ThinkRail icon.
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
const OUTER_SCALE = 0.9;
const INNER_SCALE = 0.6;
const RAIL = 56;
const TIE = 26;
/** Two ties per hexagon edge, a third and two thirds along it. */
const TIE_STOPS = [1 / 3, 2 / 3] as const;

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
const between = (a: Point, b: Point, t: number): Point => [
	round(a[0] + (b[0] - a[0]) * t),
	round(a[1] + (b[1] - a[1]) * t),
];

const OUTER_RAIL = ring(OUTER_SCALE);
const INNER_RAIL = ring(INNER_SCALE);
const SPOKES = `${at(INNER_SCALE, UPPER_LEFT).map ? "" : ""}M${xy(at(INNER_SCALE, UPPER_LEFT))} L${xy([CENTER, CENTER])} L${xy(at(INNER_SCALE, UPPER_RIGHT))} M${xy([CENTER, CENTER])} L${xy(at(INNER_SCALE, BOTTOM))}`;
const TIES = HEXAGON.flatMap((corner, index) => {
	const next = HEXAGON[(index + 1) % HEXAGON.length] ?? corner;
	return TIE_STOPS.map((stop) => {
		const point = between(corner, next, stop);
		const outer = at(OUTER_SCALE, point);
		const inner = at(INNER_SCALE, point);
		return `M${xy(outer)} L${xy(inner)}`;
	});
});

const TILE = "#000000";
const ACCENT = "#8dff4f";

const mark = (
	color: string,
) => `	<g fill="none" stroke="${color}" stroke-linejoin="round" stroke-linecap="round">
		<path d="${OUTER_RAIL}" stroke-width="${RAIL}" />
		<path d="${INNER_RAIL}" stroke-width="${RAIL}" />
		<path d="${SPOKES}" stroke-width="${RAIL}" />
		${TIES.map((d) => `<path d="${d}" stroke-width="${TIE}" />`).join("\n\t\t")}
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
		`export const BRAND_TIE_WIDTH = ${TIE};`,
		"",
		"export const BRAND_MARK_SEGMENTS = {",
		`\touterRail: ${JSON.stringify(OUTER_RAIL)},`,
		`\tinnerRail: ${JSON.stringify(INNER_RAIL)},`,
		`\tspokes: ${JSON.stringify(SPOKES)},`,
		"} as const;",
		"",
		`export const BRAND_RAIL_TIES = ${JSON.stringify(TIES)} as const;`,
	].join("\n"),
);
