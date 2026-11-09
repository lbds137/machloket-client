import {expect} from "@playwright/test";
import {MOCK_CHANNEL, drain, loginAndOpenChannel, test} from "./fixtures";

// A browser whose localStorage quota is used up refuses every setItem. The app must still
// boot a signed-in account from what it can read; it just can't save anything new.
test("a signed-in reload boots with localStorage full", async ({page, mockInstance}) => {
	void mockInstance;
	await loginAndOpenChannel(page);

	// index.ts sends a throw inside loaduser to console.error, not to pageerror: collect both,
	// with stacks, so a red run names the write that refused. Refused writes the app reports
	// itself are console errors too, so only uncaught ones fail the test.
	const uncaught: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => uncaught.push(String(error.stack ?? error)));
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	// Read the errors after a wait fails, not when the expect starts: boot logs them later.
	const withDiagnosis = (wait: Promise<void>) =>
		wait.catch((error: Error) => {
			throw new Error(JSON.stringify({uncaught, consoleErrors}) + "\n" + error.message);
		});

	// A setting from before userPreferences existed, waiting for the boot migration to move it.
	await page.evaluate(() => localStorage.setItem("theme", "Dark"));

	await page.addInitScript(() => {
		const realSetItem = Storage.prototype.setItem;
		Storage.prototype.setItem = function (key: string, value: string) {
			if (this === window.localStorage) {
				// The key and stack ride in the message so a logged refusal names its writer.
				const where = String(new Error().stack).split("\n").slice(2, 6).join(" | ");
				throw new DOMException(`Quota exceeded writing ${key} at ${where}`, "QuotaExceededError");
			}
			return realSetItem.call(this, key, value);
		};
	});
	await page.reload();

	// The migration couldn't save it, so the legacy key stays for a boot that can.
	expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("Dark");
	await withDiagnosis(expect(page.locator("#loading")).toHaveClass(/doneloading/));
	await withDiagnosis(
		expect(page.locator("#servers img.servericon").filter({visible: true}).first()).toBeVisible(),
	);
	// The reload reopens the channel from the URL; focusing it saves it as the guild's last
	// channel, a write that must not stop the channel loading. The name is set before that
	// write, so the messages are the proof (a refused write there threw without a log line).
	await withDiagnosis(expect(page.locator("#channelname")).toHaveText("#" + MOCK_CHANNEL.name));
	await withDiagnosis(
		expect(page.getByText("Welcome to the mock guild!", {exact: true})).toBeVisible(),
	);
	expect(uncaught).toEqual([]);
	// A throw the app catches is only logged: every logged error must be a refused write.
	// Network failures log too (the mock answers the recovery-codes probe 404); they aren't throws.
	const isNetwork = (text: string) => text.startsWith("Failed to load resource");
	expect(
		consoleErrors.filter((text) => !text.startsWith("QuotaExceededError") && !isNetwork(text)),
	).toEqual([]);
});

test("a plain signed-in reload doesn't rewrite userPreferences", async ({page, mockInstance}) => {
	void mockInstance;
	await loginAndOpenChannel(page);

	// Count by key: the build is minified, so stack frames can't name the writer.
	await page.addInitScript(() => {
		const realSetItem = Storage.prototype.setItem;
		const writes: string[] = [];
		(window as unknown as {preferenceWrites: string[]}).preferenceWrites = writes;
		Storage.prototype.setItem = function (key: string, value: string) {
			if (this === window.localStorage && key === "userPreferences") writes.push(value);
			return realSetItem.call(this, key, value);
		};
	});
	await page.reload();
	await expect(page.locator("#loading")).toHaveClass(/doneloading/);

	// The boot migration has nothing to move: a write here would fail on a full store.
	expect(
		await page.evaluate(() => (window as unknown as {preferenceWrites: string[]}).preferenceWrites),
	).toEqual([]);
});

test("changing a setting on a full store applies it for the session and shows one dialog", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await loginAndOpenChannel(page);
	await expect(page.locator("body")).toHaveClass(/\bOnyx-theme\b/);

	await page.evaluate(() => {
		const realSetItem = Storage.prototype.setItem;
		Storage.prototype.setItem = function (key: string, value: string) {
			if (this === window.localStorage) {
				throw new DOMException(`Quota exceeded writing ${key}`, "QuotaExceededError");
			}
			return realSetItem.call(this, key, value);
		};
	});

	await page.locator("#settings").dispatchEvent("click");
	await page
		.locator('.settingbuttons .cardLink[data-section="App settings"]', {hasText: "Appearance"})
		.click();
	const appearance = page.locator("#card-appearance");
	await expect(appearance).toBeVisible();
	const themeSelect = appearance
		.locator(".optionElement")
		.filter({has: page.locator("span", {hasText: /^Theme$/})})
		.locator("select");

	await themeSelect.selectOption({label: "Light"});
	await page.locator(".savediv button").click();

	await expect(page.locator("body")).toHaveClass(/\bLight-theme\b/);
	const dialog = page.locator(".dialogModal");
	await expect(dialog).toHaveCount(1);
	await expect(dialog).toHaveText(
		"Couldn't save this setting: this browser's storage for Machloket is full. It applies until you reload.",
	);

	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);

	await themeSelect.selectOption({label: "Dark"});
	await page.locator(".savediv button").click();
	await expect(page.locator("body")).toHaveClass(/\bDark-theme\b/);
	await drain(page);
	await expect(dialog).toHaveCount(0);
});
