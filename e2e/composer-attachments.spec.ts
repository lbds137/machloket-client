import {expect, type Locator, type Page} from "@playwright/test";
import type {channeljson} from "../src/webpage/jsontypes";
import {DESKTOP, loginAndOpenChannel, test} from "./fixtures";
import {
	MOCK_CHANNEL,
	MOCK_CHANNEL_ID,
	MOCK_GUILD,
	MOCK_GUILD_ID,
	type MockInstanceHandle,
} from "./mock";

// The files waiting in the composer belong to a channel: they leave with it and come back with it,
// and each thumbnail's own controls keep acting on the list that gets sent.
const OTHER_CHANNEL: channeljson = {
	...MOCK_CHANNEL,
	id: "1200000000000000205",
	name: "elsewhere",
	topic: "",
	position: 5,
};

test.use({...DESKTOP, mockInstanceOptions: {extraChannels: [OTHER_CHANNEL]}});

test.beforeEach(({mockInstance}) => {
	// mount the mock's routes; the handle stays unread
	void mockInstance;
});

const channelRow = (page: Page, name: string) =>
	page.locator("#channels button.channelbutton", {hasText: name});
const thumbnails = (page: Page) => page.locator("#pasteimage .containedFile");
/** The mock's own server in the server list, by its icon. */
const mockServer = (page: Page) =>
	page.locator(`#servers img.servericon[src*="/icons/${MOCK_GUILD_ID}/"]`).filter({visible: true});

/** Pastes files into the composer the way the browser hands them over. */
async function attach(page: Page, ...names: string[]) {
	await page.evaluate((names) => {
		const data = new DataTransfer();
		for (const name of names) data.items.add(new File([name], name, {type: "text/plain"}));
		document.dispatchEvent(new ClipboardEvent("paste", {clipboardData: data, cancelable: true}));
	}, names);
}

async function awayAndBack(page: Page) {
	await channelRow(page, OTHER_CHANNEL.name).click();
	await expect(page.locator("#channelname")).toHaveText("#" + OTHER_CHANNEL.name);
	await expect(thumbnails(page)).toHaveCount(0);
	await channelRow(page, MOCK_CHANNEL.name).click();
	await expect(page.locator("#channelname")).toHaveText("#" + MOCK_CHANNEL.name);
}

/** Sends the composer and answers with the file names in the request, in order. */
async function sendAndReadFiles(page: Page) {
	const request = page.waitForRequest(
		(r) => r.method() === "POST" && new URL(r.url()).pathname === `/api/v9/channels/${MOCK_CHANNEL_ID}/messages`,
	);
	await page.locator("#typebox").click();
	await page.keyboard.press("Enter");
	const body = (await request).postDataBuffer()?.toString("latin1") ?? "";
	return [...body.matchAll(/filename="([^"]*)"/g)].map((match) => match[1]);
}

test("two files waiting in the composer both come back after a channel switch, and both send", async ({
	page,
}) => {
	await loginAndOpenChannel(page);
	await attach(page, "one.txt", "two.txt");
	await expect(thumbnails(page)).toHaveCount(2);

	await awayAndBack(page);

	await expect(thumbnails(page)).toHaveCount(2);
	expect(await sendAndReadFiles(page)).toEqual(["one.txt", "two.txt"]);
});

test("tapping the open channel again keeps both files", async ({page}) => {
	await loginAndOpenChannel(page);
	await attach(page, "one.txt", "two.txt");

	await channelRow(page, MOCK_CHANNEL.name).click();

	await expect(thumbnails(page)).toHaveCount(2);
	expect(await sendAndReadFiles(page)).toEqual(["one.txt", "two.txt"]);
});

test("a file already sent doesn't come back after a channel switch", async ({page}) => {
	await loginAndOpenChannel(page);
	await attach(page, "one.txt");
	expect(await sendAndReadFiles(page)).toEqual(["one.txt"]);
	await expect(thumbnails(page)).toHaveCount(0);

	await awayAndBack(page);

	await expect(thumbnails(page)).toHaveCount(0);
});

test("a file cleared with Escape doesn't come back after a channel switch", async ({page}) => {
	await loginAndOpenChannel(page);
	await attach(page, "one.txt");
	await page.locator("#typebox").click();
	await page.keyboard.press("Escape");
	await expect(thumbnails(page)).toHaveCount(0);

	await awayAndBack(page);

	await expect(thumbnails(page)).toHaveCount(0);
});

test("a spoiler marked after a channel switch is the one that sends", async ({page}) => {
	await loginAndOpenChannel(page);
	await attach(page, "one.txt");
	await awayAndBack(page);

	await thumbnails(page).locator(".svg-spoiler").click();

	expect(await sendAndReadFiles(page)).toEqual(["SPOILER_one.txt"]);
});

test("a file removed after a channel switch stays out of the send", async ({page}) => {
	await loginAndOpenChannel(page);
	await attach(page, "one.txt", "two.txt");
	await awayAndBack(page);

	await thumbnails(page).first().locator(".svg-delete").click();

	await expect(thumbnails(page)).toHaveCount(1);
	expect(await sendAndReadFiles(page)).toEqual(["two.txt"]);
});

/** Sends the composer once, refused, and waits for its files to come back. */
async function refuseSend(page: Page, files: number) {
	let refused = false;
	await page.route("**/api/v9/channels/*/messages", (route) => {
		// The first send only: a history read on the way must not use the refusal up.
		if (refused || route.request().method() !== "POST") return route.fallback();
		refused = true;
		return route.fulfill({status: 403, json: {code: 50013, message: "Missing Permissions"}});
	});
	await page.locator("#typebox").click();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("alert")).toContainText("Missing Permissions");
	await expect(thumbnails(page)).toHaveCount(files);
}

test("a spoiler marked on a file a refused send gave back is the one that resends", async ({
	page,
}) => {
	await loginAndOpenChannel(page);
	await attach(page, "one.txt");
	await refuseSend(page, 1);

	await thumbnails(page).locator(".svg-spoiler").click();

	expect(await sendAndReadFiles(page)).toEqual(["SPOILER_one.txt"]);
});

/** Holds the next message POST until the returned function refuses it. */
async function holdSend(page: Page) {
	let refuse = () => {};
	const released = new Promise<void>((resolve) => {
		refuse = resolve;
	});
	let held = false;
	await page.route("**/api/v9/channels/*/messages", async (route) => {
		// The first send only: a history read on the way must not use the hold up.
		if (held || route.request().method() !== "POST") return route.fallback();
		held = true;
		await released;
		await route.fulfill({status: 403, json: {code: 50013, message: "Missing Permissions"}});
	});
	return refuse;
}

/** Sends the composer and holds the send, once it's left the client, until the returned function
 * refuses it. */
async function sendHeld(page: Page) {
	const refuse = await holdSend(page);
	const sent = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/messages"));
	await page.locator("#typebox").click();
	await page.keyboard.press("Enter");
	await sent;
	await expect(thumbnails(page)).toHaveCount(0);
	return refuse;
}

test("a file refused after a switch away and back comes back, and its controls still work", async ({
	page,
}) => {
	await loginAndOpenChannel(page);
	await attach(page, "one.txt");
	const refuse = await sendHeld(page);

	await awayAndBack(page);
	refuse();

	await expect(page.getByRole("alert")).toContainText("Missing Permissions");
	await expect(thumbnails(page)).toHaveCount(1);
	await thumbnails(page).locator(".svg-spoiler").click();
	expect(await sendAndReadFiles(page)).toEqual(["SPOILER_one.txt"]);
});

/** Adds a second server to the session, with OTHER_CHANNEL as its one channel. */
async function addOtherServer(page: Page, mockInstance: MockInstanceHandle) {
	const guild = "1200000000000000105";
	mockInstance.sendGatewayEvent({
		op: 0,
		t: "GUILD_CREATE",
		d: {
			...MOCK_GUILD,
			id: guild,
			properties: {...MOCK_GUILD.properties, id: guild, name: "Other Place", icon: null},
			// @everyone's role has the guild's id, and it's what lets the member see the channel.
			roles: MOCK_GUILD.roles.map((role) => ({...role, id: guild, guild_id: guild})),
			channels: [{...OTHER_CHANNEL, guild_id: guild}],
		},
	});
	const otherServer = page.locator("#servers .blankserver", {hasText: "OP"});
	await expect(otherServer).toBeVisible();
	return otherServer;
}

async function otherServerAndBack(page: Page, otherServer: Locator) {
	await otherServer.click();
	await expect(page.locator("#channelname")).toHaveText("#" + OTHER_CHANNEL.name);
	await expect(thumbnails(page)).toHaveCount(0);
	await mockServer(page).click();
	await expect(page.locator("#channelname")).toHaveText("#" + MOCK_CHANNEL.name);
}

test("a file a refused send gave back survives a trip to another server", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	const otherServer = await addOtherServer(page, mockInstance);
	await attach(page, "one.txt");
	await refuseSend(page, 1);

	await otherServerAndBack(page, otherServer);

	await expect(thumbnails(page)).toHaveCount(1);
	expect(await sendAndReadFiles(page)).toEqual(["one.txt"]);
});

test("files and text waiting in the composer survive a trip to another server", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	const otherServer = await addOtherServer(page, mockInstance);
	await attach(page, "one.txt");
	await page.locator("#typebox").click();
	await page.keyboard.type("a draft");

	await otherServerAndBack(page, otherServer);

	await expect(page.locator("#typebox")).toHaveText("a draft");
	await expect(thumbnails(page)).toHaveCount(1);
	expect(await sendAndReadFiles(page)).toEqual(["one.txt"]);
});

test("files and text waiting in the composer survive a trip to the home page", async ({page}) => {
	await loginAndOpenChannel(page);
	await attach(page, "one.txt");
	await page.locator("#typebox").click();
	await page.keyboard.type("a draft");

	await page.locator("#servers .home").first().click();
	await expect(page).toHaveURL(/\/channels\/@me/);
	await mockServer(page).click();
	await expect(page.locator("#channelname")).toHaveText("#" + MOCK_CHANNEL.name);

	await expect(page.locator("#typebox")).toHaveText("a draft");
	await expect(thumbnails(page)).toHaveCount(1);
	expect(await sendAndReadFiles(page)).toEqual(["one.txt"]);
});
