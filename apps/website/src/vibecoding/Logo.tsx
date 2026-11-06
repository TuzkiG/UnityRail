// The UnityRail mark — a hollow cube whose border is a rail track — copied from
// `apps/web/src/constants/branding.ts`; the website cannot import the app's constants.
const RAIL = 56;

const OUTER_RAIL = "M512 191.68 L824 351.84 L824 672.16 L512 832.32 L200 672.16 L200 351.84 Z";
const INNER_RAIL = "M512 339.52 L680 425.76 L680 598.24 L512 684.48 L344 598.24 L344 425.76 Z";
const SPOKES = "M344 425.76 L512 512 L680 425.76 M512 512 L512 684.48";

export function LogoMark({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 1024 1024" className={className} aria-hidden="true">
			<g
				fill="none"
				stroke="currentColor"
				strokeLinejoin="round"
				strokeLinecap="round"
				strokeWidth={RAIL}
			>
				<path d={OUTER_RAIL} />
				<path d={INNER_RAIL} />
				<path d={SPOKES} />
			</g>
		</svg>
	);
}

export function Logo({ className }: { className?: string }) {
	return (
		<span className={`inline-flex items-center gap-2.5 text-text-default ${className ?? ""}`}>
			<LogoMark className="h-9 w-9" />
		</span>
	);
}
