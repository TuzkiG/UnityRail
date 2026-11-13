import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "thinkrail-server-test-home-"));
process.env.HOME = home;
for (const name of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "GEMINI_CLI_HOME", "PI_CODING_AGENT_DIR"])
	delete process.env[name];

// A developer's shell often exports provider credentials; they must never turn a provider available
// to a test that registers only its own faux one.
const AWS_KEYS = [
	"AWS_PROFILE",
	"AWS_DEFAULT_PROFILE",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_SESSION_TOKEN",
	"AWS_SECURITY_TOKEN",
	"AWS_BEARER_TOKEN_BEDROCK",
	"AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
	"AWS_CONTAINER_CREDENTIALS_FULL_URI",
	"GOOGLE_APPLICATION_CREDENTIALS",
];
for (const name of [...Object.keys(process.env), ...AWS_KEYS]) {
	if (/(?:_API_KEY|_AUTH_TOKEN|_OAUTH_TOKEN)$/.test(name) || AWS_KEYS.includes(name))
		delete process.env[name];
}

afterAll(() => rmSync(home, { recursive: true, force: true }));
