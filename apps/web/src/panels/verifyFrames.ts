export interface TestFrame {
	path: string;
	line: number;
}

/** Unity stack frames name a script path and line: `... in Assets/Scripts/Player.cs:42`. */
export function testFrames(stackTrace: string | undefined): TestFrame[] {
	if (!stackTrace) return [];
	const frames: TestFrame[] = [];
	const seen = new Set<string>();
	for (const line of stackTrace.split(/\r?\n/)) {
		const match = /(?:in |at )?([^\s()[\]]*\.cs):(\d+)/.exec(line);
		const path = match?.[1];
		const lineNumber = Number(match?.[2]);
		if (!path || !Number.isSafeInteger(lineNumber)) continue;
		const key = `${path}:${lineNumber}`;
		if (seen.has(key)) continue;
		seen.add(key);
		frames.push({ path, line: lineNumber });
	}
	return frames;
}
