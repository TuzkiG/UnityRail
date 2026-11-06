import { describe, expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { nextCollaboration, SessionPolicyPicker } from "./SessionPolicyPicker";

function markup(
	collaboration: "default" | "ask" | "plan",
	approval: "request" | "full-auto",
): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<SessionPolicyPicker
				collaboration={collaboration}
				approval={approval}
				onCycleCollaboration={() => {}}
				onSelectApproval={() => {}}
			/>
		</TooltipProvider>,
	);
}

describe("nextCollaboration", () => {
	test("walks default → ask → plan → default", () => {
		expect(nextCollaboration("default")).toBe("ask");
		expect(nextCollaboration("ask")).toBe("plan");
		expect(nextCollaboration("plan")).toBe("default");
	});
});

describe("SessionPolicyPicker", () => {
	test("renders both knobs with the session's current values", () => {
		const html = markup("plan", "full-auto");
		expect(html).toContain('data-testid="composer-collaboration"');
		expect(html).toContain('data-collaboration="plan"');
		expect(html).toContain('data-testid="composer-approval"');
		expect(html).toContain('data-approval="full-auto"');
	});

	test("marks a read-only mode so the default state looks different", () => {
		expect(markup("ask", "request")).toContain("text-feedback-warning");
		expect(markup("default", "request")).not.toContain("text-feedback-warning");
	});
});
