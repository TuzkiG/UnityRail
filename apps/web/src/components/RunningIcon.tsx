import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useId } from "react";
import {
	BRAND_MARK_SEGMENTS,
	BRAND_RAIL_TIES,
	BRAND_RAIL_WIDTH,
	BRAND_TIE_WIDTH,
} from "../constants/branding";

const FRAME_HALVES = [
	"M20 195 V110 A90 90 0 0 1 110 20 H650 A90 90 0 0 1 740 110 V552",
	"M20 225 V650 A90 90 0 0 0 110 740 H650 A90 90 0 0 0 740 650 V548",
] as const;

/** The mark's border rails and spokes: each draws and erases on the shared 3.263s cycle, staggered. */
const STROKES: ReadonlyArray<{ d: string; className: string }> = [
	{ d: BRAND_MARK_SEGMENTS.outerRail, className: "animate-loader-t-bar" },
	{ d: BRAND_MARK_SEGMENTS.innerRail, className: "animate-loader-r-bowl" },
	{ d: BRAND_MARK_SEGMENTS.spokes, className: "animate-loader-r-tail" },
];

export function RunningIcon({ className }: { className?: string | undefined }) {
	const t = useT();
	const id = useId();

	return (
		<span
			data-testid="running-icon"
			data-running="true"
			role="img"
			aria-label={t("components.runningIcon.label")}
			className={cn("inline-flex shrink-0 items-center justify-center", className)}
		>
			<svg aria-hidden="true" viewBox="0 0 760 760" className="size-full" data-icon-id={id}>
				{FRAME_HALVES.map((d) => (
					<path
						key={d}
						data-testid="running-icon-frame"
						d={d}
						fill="none"
						stroke="currentColor"
						strokeWidth="40"
						strokeLinejoin="round"
						strokeDasharray="1000 1000"
						pathLength="1000"
						className="motion-safe:animate-loader-frame"
					/>
				))}
				<g transform="translate(-81 -81) scale(0.9)">
					<g
						fill="none"
						stroke="currentColor"
						strokeWidth={BRAND_RAIL_WIDTH}
						strokeLinejoin="round"
						strokeLinecap="round"
					>
						{STROKES.map((stroke) => (
							<path
								key={stroke.d}
								data-testid="running-icon-rail"
								d={stroke.d}
								strokeDasharray="1000 1000"
								pathLength="1000"
								className={`motion-safe:${stroke.className}`}
							/>
						))}
					</g>
					<g
						data-testid="running-icon-ties"
						fill="none"
						stroke="currentColor"
						strokeWidth={BRAND_TIE_WIDTH}
						strokeLinecap="round"
						className="motion-safe:animate-loader-ties"
					>
						{BRAND_RAIL_TIES.map((d) => (
							<path key={d} d={d} />
						))}
					</g>
				</g>
			</svg>
		</span>
	);
}
