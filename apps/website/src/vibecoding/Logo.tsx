// The UnityRail mark — a hollow cube whose border is a rail track — copied from
// `apps/web/src/constants/branding.ts`; the website cannot import the app's constants.
const RAIL = 56;
const TIE = 26;

const OUTER_RAIL = "M512 234.8 L782 373.4 L782 650.6 L512 789.2 L242 650.6 L242 373.4 Z";
const INNER_RAIL = "M512 327.2 L692 419.6 L692 604.4 L512 696.8 L332 604.4 L332 419.6 Z";
const SPOKES = "M332 419.6 L512 512 L692 419.6 M512 512 L512 696.8";
const TIES = [
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
				{TIES.map((d) => (
					<path key={d} d={d} strokeWidth={TIE} />
				))}
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
