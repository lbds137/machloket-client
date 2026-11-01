import {test as base, expect, type Page} from "@playwright/test";

const INSTANCE_NAME = "Throwaway";

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
	return {token: body.token, id: me.id, username: me.username, email, password};
}

/** Lists the throwaway instance in the picker, then logs in through the real form. */
export async function logIn(page: Page, who: RealAccount): Promise<void> {
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

	await expect(page).toHaveURL(/\/channels\/@me$/, {timeout: 30_000});
	await expect(page.locator("#loading")).toHaveClass(/doneloading/, {timeout: 30_000});
}

/** Opens a channel of the account's one guild. A guild with no icon renders a blank tile. */
export async function openOnlyGuildChannel(page: Page, channelName: string): Promise<void> {
	await page.locator("#servers .blankserver.servericon").first().click();
	await page.locator("#channels button.channelbutton", {hasText: channelName}).click();
	await expect(page.locator("#channelname")).toHaveText("#" + channelName);
}

/** Fails a spec on anything that leaves the preview server and the throwaway instance. */
export const test = base.extend<{network: void; gatewaySockets: string[]}>({
	gatewaySockets: async ({page}, use) => {
		const opened: string[] = [];
		page.on("websocket", (ws) => opened.push(ws.url()));
		await use(opened);
	},
	network: [
		async ({context, baseURL}, use) => {
			const escaped: string[] = [];
			const allowed = [new URL(baseURL!).origin, origin()];
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
			await use();
			expect(escaped, "requests that left the preview server and the instance").toEqual([]);
		},
		{auto: true},
	],
});

/** The instance's WebSocket origin, for a spec asserting the gateway really opened. */
export function gatewayOrigin(): string {
	return origin().replace("http:", "ws:");
}

export {expect};
