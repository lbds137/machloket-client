import {execFileSync} from "node:child_process";
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

/** Starts an operator's MFA recovery hold on an account, straight in the instance's database: the
 * operator's CLI needs the server's environment, and no route starts one. `completesAt` null is a
 * hold whose notice is being sent, a claim the 5-minute notice sweep leaves alone until its lease
 * runs out; a date is one the owner was told about. */
export function seedMfaRecovery(userId: string, completesAt: Date | null): void {
	const at = completesAt ? `'${completesAt.toISOString()}'` : "NULL";
	const id = `${Date.now()}${++accountSerial}`;
	instanceSql(
		"INSERT INTO mfa_recovery_requests " +
			"(id, user_id, reason, requested_by, requested_at, completes_at, status, notified_at, notice_claimed_at) VALUES " +
			`('${id}', '${userId}', 'e2e', 'e2e', now(), ${at}, 'pending', ${completesAt ? "now()" : "NULL"}, now())`,
	);
}

/** Runs one statement in the throwaway instance's database, for a state no route can reach. The
 * text runs as written: trusted SQL the test built itself, never a value from a response. */
export function instanceSql(sql: string): void {
	const pid = process.env.MACHLOKET_E2E_BOOT_PID;
	if (!pid) throw new Error("MACHLOKET_E2E_BOOT_PID unset: e2e-real/globalSetup.ts did not run");
	const engine = process.env.CONTAINER_ENGINE ?? "podman";
	const containers = execFileSync(
		engine,
		["ps", "--filter", `label=machloket-e2e.pid=${pid}`, "--format", "{{.Names}}"],
		{encoding: "utf8"},
	)
		.trim()
		.split("\n")
		.filter(Boolean);
	if (containers.length !== 1) {
		throw new Error(`expected one postgres container for boot pid ${pid}, got: ${containers}`);
	}
	const [container] = containers;
	execFileSync(engine, [
		"exec",
		container,
		"psql",
		"-U",
		"spacebar",
		"-d",
		"spacebar",
		"-v",
		"ON_ERROR_STOP=1",
		"-c",
		sql,
	]);
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
	const text = await res.text();
	let token: string | undefined;
	try {
		token = JSON.parse(text).token;
	} catch {
		// Not the JSON a success sends: the error below quotes what came instead.
	}
	if (!res.ok || !token) throw new Error(`register ${name}: ${res.status} ${text.slice(0, 300)}`);
	const me = await rest<{id: string; username: string}>(token, "GET", "/users/@me");
	// The instance auto-joins every new account to the first guild ever created on it, which
	// would make a spec's "the account's one guild" depend on the specs that ran before it.
	const inherited = await rest<{id: string}[]>(token, "GET", "/users/@me/guilds");
	for (const guild of inherited) await rest(token, "DELETE", `/users/@me/guilds/${guild.id}`);
	return {token, id: me.id, username: me.username, email, password};
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

export interface BotInteraction {
	id: string;
	token: string;
	type: number;
	data: any;
	message?: {id: string};
}

/** What the instance's HELLO offers, inside the 45 s it allows between heartbeats. Fixed rather
 * than read from the frame, so a timer's length never comes off the wire. */
const BOT_HEARTBEAT_MS = 30_000;

/** A bot's gateway session in the spec's process: a bot framework's minimum, with the
 * interactions it receives queued for the spec to answer. */
export class BotGateway {
	private readonly socket: WebSocket;
	private readonly queue: BotInteraction[] = [];
	private readonly waiting: {
		resolve: (interaction: BotInteraction) => void;
		reject: (cause: Error) => void;
	}[] = [];
	private heartbeat?: ReturnType<typeof setInterval>;
	private seq: number | null = null;
	/** Why the session is gone, so a wait for an interaction names it and doesn't just time out. */
	private dead?: Error;

	private constructor(socket: WebSocket) {
		this.socket = socket;
		socket.addEventListener("close", (event) =>
			this.die(new Error(`the bot's gateway closed: ${event.code} ${event.reason}`)),
		);
	}

	private die(cause: Error): void {
		this.dead ??= cause;
		clearInterval(this.heartbeat);
		for (const waiter of this.waiting.splice(0)) waiter.reject(this.dead);
	}

	static async connect(token: string): Promise<BotGateway> {
		const socket = new WebSocket(`${gatewayOrigin()}/?v=9&encoding=json`);
		const bot = new BotGateway(socket);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const identified = new Promise<void>((ready, fail) => {
			timer = setTimeout(() => fail(new Error("the bot got no READY in 20 s")), 20_000);
			socket.addEventListener("error", () => fail(new Error("the bot's gateway socket failed")));
			socket.addEventListener("close", (event) =>
				fail(new Error(`the bot's gateway closed before READY: ${event.code} ${event.reason}`)),
			);
			socket.addEventListener("message", (event) => {
				const frame = JSON.parse(String(event.data));
				if (frame.s) bot.seq = frame.s;
				if (frame.op === 7 || frame.op === 9) {
					// A bot framework would resume or re-identify; a test wants to hear about it.
					bot.die(new Error(`the server told the bot to reconnect (op ${frame.op})`));
					socket.close();
				} else if (frame.op === 10) {
					bot.heartbeat = setInterval(
						() => socket.send(JSON.stringify({op: 1, d: bot.seq})),
						BOT_HEARTBEAT_MS,
					);
					socket.send(
						JSON.stringify({
							op: 2,
							d: {token, intents: 1, properties: {os: "linux", browser: "e2e", device: "e2e"}},
						}),
					);
				} else if (frame.t === "READY") {
					ready();
				} else if (frame.t === "INTERACTION_CREATE") {
					const waiter = bot.waiting.shift();
					if (waiter) waiter.resolve(frame.d);
					else bot.queue.push(frame.d);
				}
			});
		});
		try {
			await identified;
		} catch (e) {
			// The caller never gets a handle to close.
			bot.close();
			throw e;
		} finally {
			clearTimeout(timer);
		}
		return bot;
	}

	/** The next interaction the bot receives. */
	next(timeoutMs = 15_000): Promise<BotInteraction> {
		const queued = this.queue.shift();
		if (queued) return Promise.resolve(queued);
		if (this.dead) return Promise.reject(this.dead);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.waiting.splice(this.waiting.indexOf(waiter), 1);
				reject(new Error(`the bot got no interaction in ${timeoutMs} ms`));
			}, timeoutMs);
			const waiter = {
				resolve: (interaction: BotInteraction) => {
					clearTimeout(timer);
					resolve(interaction);
				},
				reject: (cause: Error) => {
					clearTimeout(timer);
					reject(cause);
				},
			};
			this.waiting.push(waiter);
		});
	}

	close(): void {
		clearInterval(this.heartbeat);
		this.socket.close();
	}
}

/** Answers an interaction as a bot does: the callback route takes no authorization. */
export async function answerInteraction(interaction: BotInteraction, body: unknown): Promise<void> {
	const res = await fetch(
		`${origin()}/api/v9/interactions/${interaction.id}/${interaction.token}/callback`,
		{
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(30_000),
		},
	);
	if (!res.ok) {
		throw new Error(`callback ${JSON.stringify(body)}: ${res.status} ${(await res.text()).slice(0, 300)}`);
	}
}

/** The instance's WebSocket origin, for a spec asserting the gateway really opened. */
export function gatewayOrigin(): string {
	return origin().replace("http:", "ws:");
}

export {expect};
