// One-off generator for the UnityRail brand mark: an isometric cube with a rail track cut into it. The track
// lives inside the cube — its rails converge on a horizon just below the cube's front vertex and its near end
// opens through the cube's two lower edges — drawn flat in one brand green on the black tile, the same
// construction as the original ThinkRail icon.
//
// Run with `bun packages/shared/scripts/generate-brand-mark.ts`, then
// `bun run --cwd packages/shared generate-icons` for the rasters.
import { writeFileSync } from "node:fs";

const CENTER_X = 512;
const HALF_WIDTH = 300;
const TOP = 116;
const TOP_RISE = 154;
const SIDE = 308;
const SEAM = 20;

const APEX = [CENTER_X, TOP] as const;
const UPPER_RIGHT = [CENTER_X + HALF_WIDTH, TOP + TOP_RISE] as const;
const UPPER_LEFT = [CENTER_X - HALF_WIDTH, TOP + TOP_RISE] as const;
const MID = [CENTER_X, TOP + 2 * TOP_RISE] as const;
const LOWER_RIGHT = [CENTER_X + HALF_WIDTH, TOP + TOP_RISE + SIDE] as const;
const LOWER_LEFT = [CENTER_X - HALF_WIDTH, TOP + TOP_RISE + SIDE] as const;
const BOTTOM = [CENTER_X, TOP + 2 * TOP_RISE + SIDE] as const;
const HEXAGON = [APEX, UPPER_RIGHT, LOWER_RIGHT, BOTTOM, LOWER_LEFT, UPPER_LEFT];

/** The track's horizon sits just below the cube's front vertex; both rails run up to that one point. */
const VANISH = [CENTER_X, MID[1] + 12] as const;
const NEAR_Y = 668;
const NEAR_HALF_SPREAD = 154;
const RAIL_WIDTH = 48;
const TIE_FRACTIONS = [0.2, 0.4, 0.56, 0.69, 0.8, 0.88] as const;
const NEAR_TIE_HEIGHT = 17;
const NEAR_OVERHANG = 20;

const poly = (points: readonly (readonly [number, number])[]): string =>
	`${points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(" ")} Z`;

/** One rail: a triangle whose near edge is a full rail width and whose far end is the horizon. */
const rail = (side: 1 | -1): string =>
	poly([
		[CENTER_X + side * (NEAR_HALF_SPREAD + RAIL_WIDTH / 2), NEAR_Y],
		[CENTER_X + side * (NEAR_HALF_SPREAD - RAIL_WIDTH / 2), NEAR_Y],
		VANISH,
	]);

/** The sleeper at `f` along the track: it narrows, thins and closes in on the horizon as `f` grows. */
const sleeper = (f: number): string => {
	const near = 1 - f;
	const y = NEAR_Y + (VANISH[1] - NEAR_Y) * f;
	const half = NEAR_HALF_SPREAD * near + RAIL_WIDTH * near;
	const h = NEAR_TIE_HEIGHT * near + 6 * f;
	const x0 = CENTER_X - half - NEAR_OVERHANG * near;
	const x1 = CENTER_X + half + NEAR_OVERHANG * near;
	return poly([
		[x0, y - h / 2],
		[x1, y - h / 2],
		[x1, y + h / 2],
		[x0, y + h / 2],
	]);
};

/** A thin quad along A→B. It stops `inset` short of the junction so the two cuts never double-cover it. */
function seam(a: readonly [number, number], b: readonly [number, number]): string {
	const inset = SEAM / 2 + 2;
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const length = Math.hypot(dx, dy);
	const ux = dx / length;
	const uy = dy / length;
	const nx = -uy * (SEAM / 2);
	const ny = ux * (SEAM / 2);
	const start = [a[0] + ux * inset, a[1] + uy * inset] as const;
	const end = [b[0] - ux * inset, b[1] - uy * inset] as const;
	return poly([
		[start[0] + nx, start[1] + ny],
		[end[0] + nx, end[1] + ny],
		[end[0] - nx, end[1] - ny],
		[start[0] - nx, start[1] - ny],
	]);
}

const MARK = [
	poly(HEXAGON),
	seam(UPPER_LEFT, MID),
	seam(UPPER_RIGHT, MID),
	rail(1),
	rail(-1),
	...TIE_FRACTIONS.map((f) => sleeper(f)),
].join(" ");

const TILE = "#000000";
const ACCENT = "#8dff4f";

const colorIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
	<title>UnityRail</title>
	<rect width="1024" height="1024" rx="224" fill="${TILE}" />
	<path fill="${ACCENT}" fill-rule="evenodd" d="${MARK}" />
</svg>
`;

const monochrome = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
	<title>UnityRail</title>
	<style>
		:root { color: ${TILE}; }
		@media (prefers-color-scheme: dark) { :root { color: #f4f7f2; } }
	</style>
	<path fill="currentColor" fill-rule="evenodd" d="${MARK}" />
</svg>
`;

writeFileSync("packages/shared/assets/icon.svg", colorIcon);
writeFileSync("apps/web/public/favicon.svg", monochrome);
writeFileSync("apps/website/public/favicon.svg", monochrome);
writeFileSync("apps/website/public/vibecoding/favicon.svg", monochrome);

const railCentre = (side: 1 | -1): string =>
	`M${CENTER_X + side * NEAR_HALF_SPREAD} ${NEAR_Y} L${VANISH[0]} ${VANISH[1]}`;

console.log(
	[
		"export const BRAND_GLYPH_PATH =",
		`\t${JSON.stringify(MARK)};`,
		"",
		"export const BRAND_MARK_SEGMENTS = {",
		`\ttopFace: ${JSON.stringify(poly([APEX, UPPER_RIGHT, MID, UPPER_LEFT]))},`,
		`\tleftFace: ${JSON.stringify(poly([UPPER_LEFT, MID, BOTTOM, LOWER_LEFT]))},`,
		`\trightFace: ${JSON.stringify(poly([UPPER_RIGHT, MID, BOTTOM, LOWER_RIGHT]))},`,
		`\tleftRail: ${JSON.stringify(railCentre(-1))},`,
		`\trightRail: ${JSON.stringify(railCentre(1))},`,
		"} as const;",
	].join("\n"),
);
