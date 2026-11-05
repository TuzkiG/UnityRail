import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useId } from "react";
import { BRAND_MARK_SEGMENTS } from "../constants/branding";

const FRAME_HALVES = [
	"M20 195 V110 A90 90 0 0 1 110 20 H650 A90 90 0 0 1 740 110 V552",
	"M20 225 V650 A90 90 0 0 0 110 740 H650 A90 90 0 0 0 740 650 V548",
] as const;

/** The mark's own cube faces and rail centre lines, stroked inside the 760-unit loader frame. */
const STROKES: ReadonlyArray<{ d: string; width: number; className: string }> = [
	{ d: BRAND_MARK_SEGMENTS.topFace, width: 26, className: "animate-loader-t-bar" },
	{ d: BRAND_MARK_SEGMENTS.leftFace, width: 26, className: "animate-loader-r-bowl" },
	{ d: BRAND_MARK_SEGMENTS.rightFace, width: 26, className: "animate-loader-r-tail" },
	{ d: BRAND_MARK_SEGMENTS.leftRail, width: 40, className: "animate-loader-t-stem" },
	{ d: BRAND_MARK_SEGMENTS.rightRail, width: 40, className: "animate-loader-r-leg" },
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
				<g transform="translate(-81 23) scale(0.9)">
					{STROKES.map((stroke) => (
						<path
							key={stroke.d}
							d={stroke.d}
							fill="none"
							stroke="currentColor"
							strokeWidth={stroke.width}
							strokeLinejoin="round"
							strokeLinecap="round"
							strokeDasharray="1000 1000"
							pathLength="1000"
							className={`motion-safe:${stroke.className}`}
						/>
					))}
				</g>
			</svg>
		</span>
	);
}
