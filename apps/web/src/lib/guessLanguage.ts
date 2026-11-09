/**
 * Best-effort language for a fenced code block that carries no info string.
 * Deliberately conservative: an unknown block stays plain, and ASCII trees
 * (the common untyped fence in this app's chats) are never guessed into code.
 */
export function guessFenceLanguage(code: string): string | null {
	const lines = code.split("\n").filter((line) => line.trim() !== "");
	if (lines.length < 2) return null;
	if (looksLikeTree(lines)) return null;

	const text = lines.join("\n");
	if (/^(diff --git |@@ |\+\+\+ |--- )/m.test(text)) return "diff";
	if (isJson(text)) return "json";
	if (csharp.test(text)) return "csharp";
	if (powershell.test(text)) return "powershell";
	if (python.test(text)) return "python";
	if (sql.test(text)) return "sql";
	if (html.test(text)) return "html";
	if (typescript.test(text)) return "typescript";
	if (yaml.test(text)) return "yaml";
	if (shell.test(text)) return "shellscript";
	return null;
}

const TREE = /^\s*[├└│┌┐┘┬┴┼─]/;

function looksLikeTree(lines: readonly string[]): boolean {
	const tree = lines.filter((line) => TREE.test(line)).length;
	return tree * 3 >= lines.length;
}

function isJson(text: string): boolean {
	if (!/^[[{]/.test(text.trim())) return false;
	try {
		JSON.parse(text);
		return true;
	} catch {
		return false;
	}
}

const csharp =
	/^\s*(#if\s+UNITY_EDITOR|using\s+System|using\s+UnityEngine|namespace\s+[\w.]+|\[(?:SerializeField|Serializable|MenuItem)\b|public\s+(?:sealed\s+|static\s+|abstract\s+)?(?:class|struct|interface|enum)\s)/m;
const powershell =
	/^(?:PS [A-Za-z]:|\s*(?:Get|Set|New|Remove|Write|Select|Where|ForEach|Test)-[A-Z]\w+|\s*\$env:|\s*param\s*\()/m;
const python = /^\s*(?:import \w+|from \S+ import |def \w+\(|class \w+(?:\(\w*\))?:\s*$|print\()/m;
const sql =
	/^\s*(?:SELECT|INSERT INTO|UPDATE \w+ SET|DELETE FROM|CREATE (?:TABLE|INDEX|VIEW)|ALTER TABLE)\b/m;
const html = /^\s*<(?:!doctype|html|head|body|div|span|pre|code|script|style|template)\b/i;
const typescript =
	/^\s*(?:import .* from |import \{|export (?:default |const |function |class |interface |type )|const \w+[:=]|let \w+[:=]|interface \w+\b|type \w+ =)/m;
const yaml = /^\s*-?\s*[\w.-]+:\s*(?:\S|$)/m;
const shell =
	/^\s*(?:\$ |#!\/|\w[\w./-]* (?:-{1,2}\w|&&)|\w+ && |(?:git|cd|ls|cat|rm|mv|cp|mkdir|chmod|npm|bun|pnpm|yarn|docker|kubectl|dotnet)\s)/m;
