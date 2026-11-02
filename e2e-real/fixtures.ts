import {createHmac, randomBytes} from "node:crypto";
import {test as base, expect, type BrowserContext, type Page} from "@playwright/test";

const INSTANCE_NAME = "Throwaway";

/** A real desktop browser: a viewport override alone keeps Pixel 7's Android UA and touch flags,
 * which the app's `mobile` check keys on. Use as `test.use(DESKTOP)`. */
export const DESKTOP = {
	viewport: {width: 1280, height: 800},
	userAgent:
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
	isMobile: false,
	hasTouch: false,
};

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text: string): Buffer {
	let bits = 0;
	let value = 0;
	const out: number[] = [];
	for (const ch of text.replace(/=+$/, "").toUpperCase()) {
		const idx = BASE32.indexOf(ch);
		if (idx < 0) throw new Error(`not base32: ${ch}`);
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	return Buffer.from(out);
}

/** A fresh base32 TOTP secret (32 random base32 characters). */
export function newTotpSecret(): string {
	let out = "";
	for (const byte of randomBytes(32)) out += BASE32[byte & 31];
	return out;
}

/** RFC 6238: HMAC-SHA1, 6 digits, a 30 s step. `offsetSteps` shifts the step (+1 is the next). */
export function totpCode(secret: string, offsetSteps = 0, nowMs = Date.now()): string {
	const counter = BigInt(Math.floor(nowMs / 30_000) + offsetSteps);
	const msg = Buffer.alloc(8);
	msg.writeBigUInt64BE(counter);
	const mac = createHmac("sha1", base32Decode(secret)).update(msg).digest();
	const at = mac[mac.length - 1] & 0x0f;
	const bin = ((mac[at] & 0x7f) << 24) | (mac[at + 1] << 16) | (mac[at + 2] << 8) | mac[at + 3];
	return String(bin % 1_000_000).padStart(6, "0");
}

/** The current step's code, taken only when at least 4 s of the step remain, so it is still
 * valid when the server checks it. */
export async function currentTotp(secret: string): Promise<string> {
	const left = 30_000 - (Date.now() % 30_000);
	if (left < 4_000) await new Promise((resolve) => setTimeout(resolve, left + 100));
	return totpCode(secret);
}

/** A code that is wrong for the current and the neighbouring steps. */
export function wrongTotp(secret: string): string {
	const taken = new Set([-1, 0, 1].map((offset) => totpCode(secret, offset)));
	for (let n = 0; n < 1_000_000; n += 7919) {
		const candidate = String(n).padStart(6, "0");
		if (!taken.has(candidate)) return candidate;
	}
	throw new Error("unreachable");
}

export interface RealAccount {
	token: string;
	id: string;
	username: string;
	email: string;
	password: string;
}

function origin(): string {
	const port = process.env.MACHLOKET_E2E_PORT;
	if (!port) throw new Error("MACHLOKET_E2E_PORT unset: e2e-real/globalSetup.ts did not run");
	return `http://127.0.0.1:${port}`;
}

/** A REST call on the throwaway instance, as `token`. Throws on a refusal, with its body. */
export async function rest<T = any>(
	token: string,
	method: string,
	path: string,
	body?: unknown,
): Promise<T> {
	const res = await fetch(`${origin()}/api/v9${path}`, {
		method,
		headers: {
			Authorization: token,
			...(body === undefined ? {} : {"Content-Type": "application/json"}),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(30_000),
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
	return (text ? JSON.parse(text) : undefined) as T;
}

let accountSerial = 0;
/** Registers a fresh account and returns what the login form needs. */
export async function newAccount(label: string): Promise<RealAccount> {
	const name = `${label}${process.pid}x${++accountSerial}`;
	const email = `${name}@e2e.invalid`;
	const password = `E2e-${name}-pw!`;
	const res = await fetch(`${origin()}/api/v9/auth/register`, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({
			username: name,
			email,
			password,
			date_of_birth: "1990-01-01",
			consent: true,
		}),
		signal: AbortSignal.timeout(30_000),
	});
	const body = (await res.json().catch(() => null)) as {token?: string} | null;
	if (!res.ok || !body?.token) throw new Error(`register ${name}: ${res.status}`);
	const me = await rest<{id: string; username: string}>(body.token, "GET", "/users/@me");
	// The instance auto-joins every new account to the first guild ever created on it, which
	// would make a spec's "the account's one guild" depend on the specs that ran before it.
	const inherited = await rest<{id: string}[]>(body.token, "GET", "/users/@me/guilds");
	for (const guild of inherited) await rest(body.token, "DELETE", `/users/@me/guilds/${guild.id}`);
	return {token: body.token, id: me.id, username: me.username, email, password};
}

/** The second-factor code prompt (the login's and the MFA challenge's share their title). */
export function codePrompt(page: Page) {
	return page.locator(".dialogModal", {has: page.getByText("2FA code:", {exact: true})});
}

/** Chromium's virtual authenticator for this page, over CDP. `credentials()` is what it holds,
 * with each key's signature counter (it rises on every assertion). */
export async function addVirtualAuthenticator(page: Page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("WebAuthn.enable");
	const {authenticatorId} = await cdp.send("WebAuthn.addVirtualAuthenticator", {
		options: {
			protocol: "ctap2",
			transport: "usb",
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});
	return {
		credentials: async () =>
			(await cdp.send("WebAuthn.getCredentials", {authenticatorId})).credentials,
	};
}

/** Turns TOTP on for `who` over REST and returns the secret. Enabling replaces the token, so
 * `who.token` is updated in place. */
export async function enableTotp(who: RealAccount): Promise<string> {
	const secret = newTotpSecret();
	const res = await rest<{token: string}>(who.token, "POST", "/users/@me/mfa/totp/enable", {
		password: who.password,
		secret,
		code: await currentTotp(secret),
	});
	who.token = res.token;
	return secret;
}

/** Lists the throwaway instance in the picker and submits the real login form, stopping at
 * whatever the answer brings up. */
export async function submitLogin(page: Page, who: RealAccount): Promise<void> {
	await page.addInitScript(() => {
		// The first-boot changelog Dialog would sit over #servers.
		localStorage.setItem("fermoChangelogVersion", "0");
	});
	await page.route("**/instances.json", (route) =>
		route.fulfill({json: [{name: INSTANCE_NAME, description: "e2e", url: origin()}]}),
	);
	await page.goto("/");
	const heading = page.getByRole("heading", {name: INSTANCE_NAME, exact: true});
	await expect(heading).toBeVisible();
	await heading.click();
	await page.getByText("Already have an account?", {exact: true}).click();

	const form = page.locator(".FormSettings", {
		has: page.getByRole("button", {name: "Login", exact: true}),
	});
	const submit = form.getByRole("button", {name: "Login", exact: true});
	await expect(submit).toBeEnabled({timeout: 30_000});
	await form
		.locator(".optionElement", {has: page.getByText("Email:", {exact: true})})
		.locator("input")
		.fill(who.email);
	await form
		.locator(".optionElement", {has: page.getByText("Password:", {exact: true})})
		.locator("input")
		.fill(who.password);
	await submit.click();
}

/** Waits out a finished login: the app is up on the DM home. */
export async function expectLoggedIn(page: Page): Promise<void> {
	await expect(page).toHaveURL(/\/channels\/@me$/, {timeout: 30_000});
	await expect(page.locator("#loading")).toHaveClass(/doneloading/, {timeout: 30_000});
}

/** Logs in through the real form. An account with TOTP on passes its secret, and the second-step
 * prompt gets a code. */
export async function logIn(
	page: Page,
	who: RealAccount,
	{totpSecret}: {totpSecret?: string} = {},
): Promise<void> {
	await submitLogin(page, who);
	if (totpSecret) {
		const prompt = codePrompt(page);
		// The code is taken once the prompt shows: the login POST can outlast a TOTP step.
		await expect(prompt).toBeVisible({timeout: 30_000});
		await prompt.locator("input").fill(await currentTotp(totpSecret));
		await prompt.getByRole("button", {name: "Submit", exact: true}).click();
	}
	await expectLoggedIn(page);
}

/** Opens settings (when not open) and jumps to the card with this label, at desktop width. */
export async function openSettingsCard(page: Page, label: string): Promise<void> {
	const nav = page.locator(".settingbuttons");
	if (!(await nav.isVisible())) await page.locator("#settings").click();
	await expect(nav).toBeVisible();
	await nav.locator(".cardLink", {hasText: label}).click();
	await expect(page.locator("#card-" + label.replace(/\s+/g, "-").toLowerCase())).toBeVisible();
}

/** Closes the settings overlay with its X. */
export async function closeSettings(page: Page): Promise<void> {
	await page.locator(".menu.background > .exitsettings.svg-x").click();
	await expect(page.locator(".settingbuttons")).toHaveCount(0);
}

/** Matches a channel row whose whole text is this name. */
export function channelRowText(channelName: string): RegExp {
	return new RegExp(`^\\s*${channelName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
}

/** Opens a channel of the account's one guild. A guild with no icon renders a blank tile. */
export async function openOnlyGuildChannel(page: Page, channelName: string): Promise<void> {
	await page.locator("#servers .blankserver.servericon").first().click();
	await page
		.locator("#channels button.channelbutton", {hasText: channelRowText(channelName)})
		.click();
	await expect(page.locator("#channelname")).toHaveText("#" + channelName);
}

/** Aborts whatever a context asks of anything but the preview server and the instance, and
 * returns the list that fills with what it aborted. */
async function guardContext(context: BrowserContext, baseURL: string): Promise<string[]> {
	const escaped: string[] = [];
	const allowed = [new URL(baseURL).origin, origin()];
	await context.route(
		(url) => !allowed.includes(url.origin),
		(route) => {
			escaped.push(route.request().url());
			return route.abort();
		},
	);
	// context.route never sees a WebSocket.
	const instanceSocket = gatewayOrigin();
	await context.routeWebSocket(
		(url) => url.origin !== instanceSocket,
		(ws) => {
			escaped.push(ws.url());
			ws.close().catch(() => {});
		},
	);
	return escaped;
}

const ESCAPED = "requests that left the preview server and the instance";

/**
 * Fails a spec on anything that leaves the preview server and the throwaway instance. It assumes
 * the API, the CDN and the gateway share the instance's one port.
 */
export const test = base.extend<{
	network: void;
	gatewaySockets: string[];
	/** Opens one more desktop browser context (its own storage, so its own login), guarded like
	 * the first; they close after the test. */
	extraPage: () => Promise<Page>;
}>({
	gatewaySockets: async ({page}, use) => {
		const opened: string[] = [];
		page.on("websocket", (ws) => opened.push(ws.url()));
		await use(opened);
	},
	extraPage: async ({browser, baseURL}, use) => {
		const guards: string[][] = [];
		const contexts: BrowserContext[] = [];
		await use(async () => {
			const context = await browser.newContext({
				...DESKTOP,
				baseURL,
				serviceWorkers: "block",
				locale: "en-US",
				timezoneId: "UTC",
			});
			contexts.push(context);
			guards.push(await guardContext(context, baseURL!));
			return context.newPage();
		});
		// Judged first: a context that fails to close mustn't hide an escaped request.
		const escaped = guards.flat();
		for (const context of contexts) await context.close().catch(() => {});
		expect(escaped, ESCAPED).toEqual([]);
	},
	network: [
		async ({context, baseURL}, use) => {
			const escaped = await guardContext(context, baseURL!);
			await use();
			expect(escaped, ESCAPED).toEqual([]);
		},
		{auto: true},
	],
});

/** The instance's WebSocket origin, for a spec asserting the gateway really opened. */
export function gatewayOrigin(): string {
	return origin().replace("http:", "ws:");
}

export {expect};
