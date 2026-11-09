import { expect, test } from "bun:test";
import { guessFenceLanguage } from "./guessLanguage";

test("a Unity C# fence is guessed from its usings and class", () => {
	expect(
		guessFenceLanguage(
			"using UnityEngine;\n\nnamespace Test {\n    public class Fix : MonoBehaviour {\n    }\n}",
		),
	).toBe("csharp");
});

test("a PowerShell fence is guessed from its cmdlets", () => {
	expect(
		guessFenceLanguage("Get-ChildItem -Path . | Select-Object Name\nRemove-Item .\\a.cs"),
	).toBe("powershell");
});

test("JSON, YAML, SQL, HTML and shell fences are guessed", () => {
	expect(guessFenceLanguage('{\n  "a": 1,\n  "b": [2]\n}')).toBe("json");
	expect(guessFenceLanguage("name: build\nsteps:\n  - run")).toBe("yaml");
	expect(guessFenceLanguage("SELECT id\nFROM users")).toBe("sql");
	expect(guessFenceLanguage('<div class="x">\n  <span>hi</span>\n</div>')).toBe("html");
	expect(guessFenceLanguage("git status --porcelain\nbun test")).toBe("shellscript");
});

test("a diff keeps its own language", () => {
	expect(guessFenceLanguage("diff --git a/a.cs b/a.cs\n@@ -1 +1 @@\n-a\n+b")).toBe("diff");
});

test("an ASCII tree and plain prose stay uncolored", () => {
	expect(guessFenceLanguage("ht_cav_start\n└ ht_tf_progress\n  └ ht_scv_reward")).toBeNull();
	expect(guessFenceLanguage("第一行说明\n第二行说明")).toBeNull();
	expect(guessFenceLanguage("single line")).toBeNull();
});
