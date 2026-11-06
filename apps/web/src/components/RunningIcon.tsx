import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useId } from "react";
import { BRAND_MARK_SEGMENTS, BRAND_RAIL_WIDTH } from "../constants/branding";

/** The rounded-square track the working light laps. */
const FRAME_TRACK =
	"M110 20 H650 A90 90 0 0 1 740 110 V650 A90 90 0 0 1 650 740 H110 A90 90 0 0 1 20 650 V110 A90 90 0 0 1 110 20 Z";

const STROKES = [
	BRAND_MARK_SEGMENTS.outerRail,
	BRAND_MARK_SEGMENTS.innerRail,
	BRAND_MARK_SEGMENTS.spokes,
] as const;

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
				<path
					data-testid="running-icon-frame"
					d={FRAME_TRACK}
					fill="none"
					stroke="currentColor"
					strokeWidth="40"
					className="motion-safe:opacity-40"
				/>
				<path
					data-testid="running-icon-comet"
					d={FRAME_TRACK}
					fill="none"
					stroke="currentColor"
					strokeWidth="40"
					strokeDasharray="140 860"
					pathLength="1000"
					className="motion-safe:animate-loader-comet"
				/>
				<g transform="translate(11.36 11.36) scale(0.72)">
					<g
						fill="none"
						stroke="currentColor"
						strokeWidth={BRAND_RAIL_WIDTH}
						strokeLinejoin="round"
						strokeLinecap="round"
					>
						{STROKES.map((d) => (
							<path key={d} data-testid="running-icon-rail" d={d} />
						))}
					</g>
				</g>
			</svg>
		</span>
	);
}
