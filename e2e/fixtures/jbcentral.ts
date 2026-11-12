import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { JBCENTRAL_STATUS_TTL_MS } from "@thinkrail/shared/jbcentral";
import { windowsGitBash } from "./executables";
import {
	E2E_CENTRAL_EXTENSION_SOURCE,
	E2E_CENTRAL_LOG,
	E2E_CENTRAL_STATE,
	E2E_FAKE_BIN_DIR,
	E2E_HOME_DIR,
} from "./paths";

const REVIEWED_ARGV = [
	"--version",
	"status",
	"quota --json",
	"add pi",
	"remove pi",
	"proxy start --ensure-updated",
	"login",
	"update --install",
];

export async function openProviders(page: Page): Promise<Locator> {
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();
	return page.getByTestId("jetbrains-ai-card");
}

export async function waitForCentralState(page: Page, state: string): Promise<Locator> {
	const card = page.getByTestId("jetbrains-ai-card");
	await expect(card).toHaveAttribute("data-state", state, { timeout: 15_000 });
	return card;
}

export function centralInvocations(): string[] {
	if (!existsSync(E2E_CENTRAL_LOG)) return [];
	return readFileSync(E2E_CENTRAL_LOG, "utf8").trim().split("\n").filter(Boolean);
}

export function centralInvocationCount(argv: string): number {
	return centralInvocations().filter((invocation) => invocation === argv).length;
}

export function assertOnlyReviewedArgv(): void {
	for (const invocation of centralInvocations()) {
		expect(REVIEWED_ARGV).toContain(invocation);
	}
}

export function runCentralOnHost(...argv: string[]): void {
	const script = join(E2E_FAKE_BIN_DIR, "central");
	const command = process.platform === "win32" ? windowsGitBash() : script;
	const args = process.platform === "win32" ? [script, ...argv] : argv;
	execFileSync(command, args, {
		env: {
			PATH: "/usr/bin:/bin",
			HOME: E2E_HOME_DIR,
			CENTRAL_STUB_STATE: E2E_CENTRAL_STATE,
			CENTRAL_STUB_LOG: E2E_CENTRAL_LOG,
			CENTRAL_STUB_EXTENSION_SOURCE: E2E_CENTRAL_EXTENSION_SOURCE,
		},
		stdio: "ignore",
	});
}

export function setCentralInstalled(installed: boolean): void {
	const live = join(E2E_FAKE_BIN_DIR, "central");
	const hidden = join(E2E_FAKE_BIN_DIR, "central.uninstalled");
	if (installed === existsSync(live)) return;
	renameCentralStub(installed ? hidden : live, installed ? live : hidden);
}

/**
 * Moves the POSIX stub and its Windows `.cmd` launcher together: the launcher resolves through PATHEXT
 * even when the stub is gone, so a hidden stub must hide its launcher too or the host still discovers
 * `central` and reports a probe failure instead of "absent".
 */
export function renameCentralStub(from: string, to: string): void {
	// renameSync, not `mv`: the runner's PATH need not carry a POSIX userland on Windows.
	renameSync(from, to);
	if (process.platform === "win32") {
		const fromShim = `${from}.cmd`;
		const toShim = `${to}.cmd`;
		if (existsSync(fromShim)) renameSync(fromShim, toShim);
	}
}

export async function connectCentral(page: Page): Promise<void> {
	const connect = page.getByTestId("jetbrains-connect");
	await expect(async () => {
		if (!(await connect.isVisible())) await page.getByTestId("providers-refresh").click();
		await expect(connect).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 30_000 });
	await connect.click();
}

export async function waitForVersionProbe(after: number): Promise<void> {
	await expect
		.poll(() => centralInvocationCount("--version"), { timeout: 15_000 })
		.toBeGreaterThan(after);
}

export async function reprobeCentralStatus(page: Page): Promise<void> {
	const probes = centralInvocationCount("status");
	await page.waitForTimeout(JBCENTRAL_STATUS_TTL_MS + 250);
	await page.getByTestId("providers-refresh").click();
	await expect
		.poll(() => centralInvocationCount("status"), { timeout: 15_000 })
		.toBeGreaterThan(probes);
}
