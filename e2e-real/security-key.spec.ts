import {
	DESKTOP,
	addVirtualAuthenticator,
	expect,
	logIn,
	newAccount,
	openSettingsCard,
	rest,
	test,
} from "./fixtures";
import type {Page} from "@playwright/test";

test.use(DESKTOP);

type Key = {id: string; name: string};

async function openKeyMenu(page: Page): Promise<void> {
	await openSettingsCard(page, "Account settings");
	await page.getByRole("button", {name: "Manage security keys", exact: true}).click();
	await expect(page.getByRole("button", {name: "Add key", exact: true})).toBeVisible();
}

async function addKey(page: Page, who: {password: string}, name: string): Promise<void> {
	await page.getByRole("button", {name: "Add key", exact: true}).click();
	const form = page.locator(".FormSettings", {
		has: page.getByRole("button", {name: "Submit", exact: true}),
	});
	await form
		.locator("div", {has: page.getByText("Password:", {exact: true})})
		.locator("input[type=password]")
		.last()
		.fill(who.password);
	await form
		.locator("div", {has: page.getByText("Key name:", {exact: true})})
		.locator("input")
		.last()
		.fill(name);
	await form.getByRole("button", {name: "Submit", exact: true}).click();
}

async function setUp(page: Page, name: string) {
	const me = await newAccount(name);
	const authenticator = await addVirtualAuthenticator(page);
	const mfaCalls: string[] = [];
	page.on("request", (req) => {
		const url = new URL(req.url());
		if (url.pathname.endsWith("/users/@me/mfa/webauthn")) mfaCalls.push(req.method());
	});
	const listed = () => rest<Key[]>(me.token, "GET", "/users/@me/mfa/webauthn/credentials");
	await logIn(page, me);
	await openKeyMenu(page);
	return {me, authenticator, mfaCalls, listed};
}

// The real browser ceremony against the server's own WebAuthn checks: Chromium's virtual
// authenticator makes the keys, and the server's list and 60003 gate decide what the page may do.
test("the first key is added through a real ceremony with no second factor asked", async ({
	page,
}) => {
	const {me, authenticator, mfaCalls, listed} = await setUp(page, "keyfirst");

	await addKey(page, me, "Key one");
	await expect(page.getByRole("button", {name: "Key one", exact: true})).toBeVisible();
	expect((await listed()).map((k) => k.name)).toEqual(["Key one"]);
	expect(mfaCalls, "no MFA challenge for an account with no factor").toEqual([]);
	expect(await authenticator.credentials()).toHaveLength(1);
});

test("with a key present, the second key and a removal each ask for the key first", async ({
	page,
}) => {
	const {me, authenticator, mfaCalls, listed} = await setUp(page, "keytwo");

	await addKey(page, me, "Key one");
	await expect(page.getByRole("button", {name: "Key one", exact: true})).toBeVisible();
	expect(mfaCalls).toEqual([]);
	// The first factor's backup codes sit over the menu until they're acknowledged.
	await page.getByRole("button", {name: "I've saved them", exact: true}).click();

	await test.step("the second key is gated: the server asks, the first key answers", async () => {
		const before = (await authenticator.credentials())[0].signCount;
		await addKey(page, me, "Key two");
		await expect(page.getByRole("button", {name: "Key two", exact: true})).toBeVisible();
		await expect(page.getByRole("button", {name: "Key one", exact: true})).toBeVisible();
		expect((await listed()).map((k) => k.name).sort()).toEqual(["Key one", "Key two"]);
		// The challenge ran: the client asked for and answered an assertion with the first key.
		expect(mfaCalls.length).toBeGreaterThan(0);
		const creds = await authenticator.credentials();
		expect(creds).toHaveLength(2);
		expect(Math.max(...creds.map((c) => c.signCount))).toBeGreaterThan(before);
	});

	await test.step("removing a key asks again in a new sitting", async () => {
		// A reload drops the client's in-memory second-factor token.
		mfaCalls.length = 0;
		await page.goto("/channels/@me");
		await expect(page.locator("#loading")).toHaveClass(/doneloading/, {timeout: 30_000});
		await openKeyMenu(page);
		await expect(page.getByRole("button", {name: "Key two", exact: true})).toBeVisible();
		await page.getByRole("button", {name: "Key two", exact: true}).click();
		// The retry is the one that lands: wait past the first answer, the 60003 that starts the
		// challenge, and judge the last status on its own.
		const removal = page.waitForResponse(
			(res) =>
				res.request().method() === "DELETE" &&
				res.url().includes("/mfa/webauthn/") &&
				res.status() !== 400,
		);
		await page.getByRole("button", {name: "Delete", exact: true}).click();
		expect((await removal).status()).toBeLessThan(300);
		// Both steps of the challenge: the options, then the signed answer.
		expect(mfaCalls).toEqual(["POST", "POST"]);
		expect((await listed()).map((k) => k.name)).toEqual(["Key one"]);
		// Back on the list: the other key stays, the removed one is gone.
		await expect(page.getByRole("button", {name: "Key one", exact: true})).toBeVisible();
		await expect(page.getByRole("button", {name: "Key two", exact: true})).toHaveCount(0);
	});
});
