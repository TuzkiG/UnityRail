// The UnityRail mark — a hollow cube whose border is a rail track — copied from
// `apps/web/src/constants/branding.ts`; the website cannot import the app's constants.
const RAIL = 56;

const OUTER_RAIL = "M512 123.92 L890 317.96 L890 706.04 L512 900.08 L134 706.04 L134 317.96 Z";
const INNER_RAIL = "M512 240.96 L776 376.48 L776 647.52 L512 783.04 L248 647.52 L248 376.48 Z";
const SPOKES = "M248 376.48 L512 512 L776 376.48 M512 512 L512 783.04";

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
