import { resultText, strArg, type ToolRenderProps } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { useHighlightedCode } from "@/lib/highlightCode";
import { ansiSpans } from "./ansiSpans";
import { highlightedLines } from "./highlightedLines";

export function BashCard({ args, result, status }: ToolRenderProps) {
	const t = useT();
	const command = strArg(args, "command");
	const output = resultText(result);
	const isError = status === "error";
	const commandHtml = useHighlightedCode(command, "shellscript");
	const body = ansiSpans(
		output || (status === "running" ? t("tools.bash.running") : t("tools.bash.noOutput")),
	);

	return (
		<div
			data-testid="tool-bash"
			className="overflow-hidden rounded-sm border border-border-default bg-container-header-bg tr-code-text"
		>
			<div className="border-border-default border-b px-8 py-4">
				<span className="text-feedback-success">$</span>
				{commandHtml ? (
					<pre
						className="ml-8 inline whitespace-pre-wrap break-words tr-code-text"
						dangerouslySetInnerHTML={{ __html: highlightedLines(commandHtml).join("\n") }}
					/>
				) : (
					<span className="ml-8 text-text-muted">{command}</span>
				)}
			</div>
			<pre
				className={`overflow-auto px-8 py-4 tr-code-text leading-relaxed ${isError ? "text-feedback-error" : "text-text-default"}`}
			>
				{body.map((span, index) => (
					<span key={index} data-ansi={span.tone ?? undefined}>
						{span.text}
					</span>
				))}
			</pre>
		</div>
	);
}
