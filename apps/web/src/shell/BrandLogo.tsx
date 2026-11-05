import { BRAND_GLYPH_PATH, PRODUCT_NAME } from "../constants/branding";

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
			<path fill="currentColor" fillRule="evenodd" d={BRAND_GLYPH_PATH} />
		</svg>
	);
}
