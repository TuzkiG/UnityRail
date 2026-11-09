export type AnsiTone =
	| "black"
	| "red"
	| "green"
	| "yellow"
	| "blue"
	| "magenta"
	| "cyan"
	| "white"
	| "brightBlack"
	| "brightRed"
	| "brightGreen"
	| "brightYellow"
	| "brightBlue"
	| "brightMagenta"
	| "brightCyan"
	| "brightWhite";

export interface AnsiSpan {
	text: string;
	tone: AnsiTone | null;
}

const BASE: AnsiTone[] = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
const BRIGHT: AnsiTone[] = [
	"brightBlack",
	"brightRed",
	"brightGreen",
	"brightYellow",
	"brightBlue",
	"brightMagenta",
	"brightCyan",
	"brightWhite",
];

const CSI = /^[0-9;?]*[A-Za-z]/;

/**
 * Splits terminal output into themed spans. SGR foreground colors survive;
 * every other escape sequence is dropped so it never reaches the DOM.
 */
export function ansiSpans(text: string): AnsiSpan[] {
	const spans: AnsiSpan[] = [];
	let tone: AnsiTone | null = null;
	let index = 0;
	let buffer = "";

	const flush = () => {
		if (buffer === "") return;
		spans.push({ text: buffer, tone });
		buffer = "";
	};

	while (index < text.length) {
		const start = text.indexOf("\u001b[", index);
		if (start < 0) {
			buffer += text.slice(index);
			break;
		}
		buffer += text.slice(index, start);
		const sequence = CSI.exec(text.slice(start + 2));
		if (!sequence) {
			index = start + 2;
			continue;
		}
		const end = sequence[0];
		const params = end.slice(0, -1);
		index = start + 2 + end.length;
		if (end.at(-1) !== "m") continue;
		flush();
		for (const part of params.split(";")) {
			const code = part === "" ? 0 : Number(part);
			if (code === 0 || code === 39) tone = null;
			else if (code >= 30 && code <= 37) tone = BASE[code - 30] ?? tone;
			else if (code >= 90 && code <= 97) tone = BRIGHT[code - 90] ?? tone;
		}
	}
	flush();
	return spans;
}
