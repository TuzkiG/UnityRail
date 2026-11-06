import {
	BRAND_MARK_SEGMENTS,
	BRAND_RAIL_TIES,
	BRAND_RAIL_WIDTH,
	BRAND_TIE_WIDTH,
	PRODUCT_NAME,
} from "../constants/branding";

export function BrandLogo() {
	return (
		<svg
			data-testid="brand-logo"
			role="img"
			aria-label={PRODUCT_NAME}
			width="32"
			height="32"
			viewBox="0 0 1024 1024"
			className="size-[32px] shrink-0 text-primary"
			xmlns="http://www.w3.org/2000/svg"
		>
			<g fill="none" stroke="currentColor" strokeLinejoin="round" strokeLinecap="round">
				<path d={BRAND_MARK_SEGMENTS.outerRail} strokeWidth={BRAND_RAIL_WIDTH} />
				<path d={BRAND_MARK_SEGMENTS.innerRail} strokeWidth={BRAND_RAIL_WIDTH} />
				<path d={BRAND_MARK_SEGMENTS.spokes} strokeWidth={BRAND_RAIL_WIDTH} />
				{BRAND_RAIL_TIES.map((d) => (
					<path key={d} d={d} strokeWidth={BRAND_TIE_WIDTH} />
				))}
			</g>
		</svg>
	);
}
