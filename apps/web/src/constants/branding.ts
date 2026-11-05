export const PRODUCT_NAME = "UnityRail";
/** Storage and protocol identity keep the original slug so existing host state, browser storage and
 * MIME types survive the display-name change. */
export const APP_SLUG = "thinkrail";
export const STORAGE_PREFIX = `${APP_SLUG}-`;
export const DND_FILE_MIME = `application/x-${APP_SLUG}-file`;
export const EVENT_PREFIX = `${APP_SLUG}:`;

/**
 * The brand glyph: an isometric cube whose lower body carries a rail track cut clean through it. The rails run
 * up from the cube's two lower edges and converge on a horizon just below its front vertex, the ties narrowing
 * and closing in with them — the track lives inside the cube. Flat in one brand green on the black tile, like
 * the original ThinkRail icon, and `BRAND_GLYPH_PATH` is the whole mark in one even-odd path. The named faces
 * are the running-icon animation's stroke outlines; the rails are their centre lines, because the loader draws
 * them as single-weight bars.
 */
export const BRAND_GLYPH_PATH =
	"M512 116 L812 270 L812 578 L512 732 L212 578 L212 270 Z M218.10880740214193 284.3764554784389 L496.7576358995099 427.4161874404211 L505.89119259785804 409.6235445215611 L227.2423641004901 266.5838125595789 Z M796.7576358995099 266.5838125595789 L518.1088074021419 409.6235445215611 L527.2423641004901 427.4161874404211 L805.8911925978581 284.3764554784389 Z M690 668 L642 668 L512 436 Z M334 668 L382 668 L512 436 Z M334.4 614.2 L689.6 614.2 L689.6 629 L334.4 629 Z M378.8 568.9000000000001 L645.2 568.9000000000001 L645.2 581.5 L378.8 581.5 Z M414.32 532.66 L609.68 532.66 L609.68 543.4999999999999 L414.32 543.4999999999999 Z M443.18 503.21500000000003 L580.82 503.21500000000003 L580.82 512.625 L443.18 512.625 Z M467.6 478.29999999999995 L556.4 478.29999999999995 L556.4 486.5 L467.6 486.5 Z M485.36 460.18 L538.64 460.18 L538.64 467.50000000000006 L485.36 467.50000000000006 Z";

export const BRAND_MARK_SEGMENTS = {
	topFace: "M512 116 L812 270 L512 424 L212 270 Z",
	leftFace: "M212 270 L512 424 L512 732 L212 578 Z",
	rightFace: "M812 270 L512 424 L512 732 L812 578 Z",
	leftRail: "M358 668 L512 436",
	rightRail: "M666 668 L512 436",
} as const;
