import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = realpathSync(dirname(dirname(fileURLToPath(import.meta.url))));

// Windows places per-user temp folders under the user profile, where a fixture project inherits the
// machine owner's personal `.agents/skills` through the trust walk (the host's hermetic HOME is the
// lane's own). The data root therefore sits next to the repository — outside the profile for that walk
// and outside the repository itself so a "plain folder" fixture stays genuinely non-git.
export const E2E_DATA_ROOT =
	process.platform === "win32" ? join(dirname(repoRoot), ".e2e-data") : tmpdir();

export const E2E_TMP_ROOT = process.platform === "win32" ? join(E2E_DATA_ROOT, "tmp") : tmpdir();
