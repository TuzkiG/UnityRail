export const PRODUCT_NAME = "UnityRail";
/** Storage and protocol identity keep the original slug so existing host state, browser storage and
 * MIME types survive the display-name change. */
export const APP_SLUG = "thinkrail";
export const REPO_URL = "https://github.com/JetBrains/thinkrail";
export const STORAGE_PREFIX = `${APP_SLUG}-`;
export const DND_FILE_MIME = `application/x-${APP_SLUG}-file`;
export const EVENT_PREFIX = `${APP_SLUG}:`;

/**
 * The brand mark: a hollow isometric cube whose border is a rail track. Two concentric hexagonal rails —
 * the outer at 126% and the inner at 88% of the base hexagon's centreline — close the cube, and its three
 * inner edges are spokes from the centre to the inner rail. Flat in one brand green on the black tile, like
 * the original ThinkRail icon; every part is a stroked path, so the shell logo, the favicon, the app icon and
 * the working badge share one geometry.
 */
export const BRAND_RAIL_WIDTH = 56;

export const BRAND_MARK_SEGMENTS = {
	outerRail: "M512 123.92 L890 317.96 L890 706.04 L512 900.08 L134 706.04 L134 317.96 Z",
	innerRail: "M512 240.96 L776 376.48 L776 647.52 L512 783.04 L248 647.52 L248 376.48 Z",
	spokes: "M248 376.48 L512 512 L776 376.48 M512 512 L512 783.04",
} as const;
