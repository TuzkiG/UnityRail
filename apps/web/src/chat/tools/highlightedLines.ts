const TAG = "code";
const CODE_OPEN = `<${TAG}>`;
const CODE_CLOSE = `</${TAG}>`;

/**
 * Shiki wraps each line in `<span class="line">` and joins them with a newline,
 * so splitting inside the code element yields one single-line HTML snippet per line.
 */
export function highlightedLines(html: string): string[] {
	const start = html.indexOf(CODE_OPEN);
	const end = html.lastIndexOf(CODE_CLOSE);
	if (start < 0 || end <= start) return [];
	return html.slice(start + CODE_OPEN.length, end).split("\n");
}
