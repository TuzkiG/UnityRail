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
 * the outer at 104% and the inner at 56% of the base hexagon's centreline — close the cube, and its three
 * inner edges are spokes from the centre to the inner rail. Flat in one brand green on the black tile, like
 * the original ThinkRail icon; every part is a stroked path, so the shell logo, the favicon, the app icon and
 * the working badge share one geometry. The named segments are the running-icon animation's strokes.
 */
export const BRAND_RAIL_WIDTH = 56;

export const BRAND_MARK_SEGMENTS = {
	outerRail: "M512 191.68 L824 351.84 L824 672.16 L512 832.32 L200 672.16 L200 351.84 Z",
	innerRail: "M512 339.52 L680 425.76 L680 598.24 L512 684.48 L344 598.24 L344 425.76 Z",
	spokes: "M344 425.76 L512 512 L680 425.76 M512 512 L512 684.48",
} as const;
