export const PRODUCT_NAME = "UnityRail";
/** Storage and protocol identity keep the original slug so existing host state, browser storage and
 * MIME types survive the display-name change. */
export const APP_SLUG = "thinkrail";
export const REPO_URL = "https://github.com/JetBrains/thinkrail";
export const STORAGE_PREFIX = `${APP_SLUG}-`;
export const DND_FILE_MIME = `application/x-${APP_SLUG}-file`;
export const EVENT_PREFIX = `${APP_SLUG}:`;

/**
 * The brand mark: a hollow isometric cube whose border is a rail track. Two concentric hexagonal rails sit
 * 98.56 units apart (centrelines), joined by twelve ties, and the cube's three inner edges are spokes from
 * the centre to the inner rail. Flat in one brand green on the black tile, like the original ThinkRail icon;
 * every part is a stroked path, so the shell logo, the favicon, the app icon and the working badge share one
 * geometry. The named segments are the running-icon animation's strokes; `BRAND_RAIL_TIES` are the rungs.
 */
export const BRAND_RAIL_WIDTH = 56;
export const BRAND_TIE_WIDTH = 26;

export const BRAND_MARK_SEGMENTS = {
	outerRail: "M512 234.8 L782 373.4 L782 650.6 L512 789.2 L242 650.6 L242 373.4 Z",
	innerRail: "M512 327.2 L692 419.6 L692 604.4 L512 696.8 L332 604.4 L332 419.6 Z",
	spokes: "M332 419.6 L512 512 L692 419.6 M512 512 L512 696.8",
} as const;

export const BRAND_RAIL_TIES = [
	"M602 281 L572 358",
	"M692 327.2 L632 388.8",
	"M782 465.8 L692 481.2",
	"M782 558.2 L692 542.8",
	"M692 696.8 L632 635.2",
	"M602 743 L572 666",
	"M422 743 L452 666",
	"M332 696.8 L392 635.2",
	"M242 558.2 L332 542.8",
	"M242 465.8 L332 481.2",
	"M332 327.2 L392 388.8",
	"M422 281 L452 358",
] as const;
