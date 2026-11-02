import {expect, type Page} from "@playwright/test";
import {
	DESKTOP,
	MOCK_CHANNEL,
	MOCK_VOICE_CHANNEL,
	type MockInstanceHandle,
	loginAndOpenChannel,
	test,
} from "./fixtures";

test.use({...DESKTOP, mockInstanceOptions: {extraChannels: [MOCK_VOICE_CHANNEL]}});

// A voice channel opens as voice only once READY_SUPPLEMENTAL says voice is on here.
function voiceOn(mockInstance: MockInstanceHandle) {
	mockInstance.sendGatewayEvent({
		op: 0,
		t: "READY_SUPPLEMENTAL",
		s: 90,
		d: {guilds: [{voice_states: []}], merged_presences: {friends: []}},
	});
}

function voiceRow(page: Page) {
	return page.locator("#channels button.channelbutton", {hasText: MOCK_VOICE_CHANNEL.name});
}

test.describe("a voice channel's chat button", () => {
	async function openVoiceChannel(page: Page, mockInstance: MockInstanceHandle) {
		await loginAndOpenChannel(page);
		voiceOn(mockInstance);
		await expect(page.locator("#scrollWrap .messagediv").first()).toBeVisible();
		await voiceRow(page).click();
		const chatButton = page.locator("#voiceArea .callVoiceIcon:has(.svg-frmessage)");
		await expect(chatButton).toBeVisible();
		await expect(page.locator("#chatArea")).toBeHidden();
		return chatButton;
	}

	test("brings up the channel's messages", async ({page, mockInstance}) => {
		const chatButton = await openVoiceChannel(page, mockInstance);
		const fetched: string[] = [];
		page.on("request", (request) => {
			if (request.url().includes(`/channels/${MOCK_VOICE_CHANNEL.id}/messages?`)) {
				fetched.push(request.url());
			}
		});

		await chatButton.click();

		await expect(page.locator("#chatArea")).toBeVisible();
		await expect.poll(() => fetched.length).toBeGreaterThan(0);
		await expect(page.locator("#scrollWrap .messagediv").first()).toBeVisible();
	});

	test("hides the chat again on a second tap, and adds nothing to back", async ({
		page,
		mockInstance,
	}) => {
		const chatButton = await openVoiceChannel(page, mockInstance);
		const entries = await page.evaluate(() => history.length);

		await chatButton.click();
		await expect(page.locator("#chatArea")).toBeVisible();
		await chatButton.click();
		await expect(page.locator("#chatArea")).toBeHidden();

		expect(await page.evaluate(() => history.length)).toBe(entries);
	});

	test("reopens the chat with its messages after hiding it", async ({page, mockInstance}) => {
		const chatButton = await openVoiceChannel(page, mockInstance);

		await chatButton.click();
		await expect(page.locator("#scrollWrap .messagediv").first()).toBeVisible();
		await chatButton.click();
		await chatButton.click();

		await expect(page.locator("#chatArea")).toBeVisible();
		await expect(page.locator("#scrollWrap .messagediv").first()).toBeVisible();
		await expect(page.locator("#loadingdiv")).not.toHaveClass(/loading/);
	});
});

test.describe("an 18+ voice channel's chat button", () => {
	const GATED_VOICE = {...MOCK_VOICE_CHANNEL, name: "late-call", nsfw: true};
	test.use({mockInstanceOptions: {extraChannels: [GATED_VOICE]}});

	test("shows the age gate, not the messages, until it's answered", async ({page, mockInstance}) => {
		await loginAndOpenChannel(page);
		voiceOn(mockInstance);
		await expect(page.locator("#scrollWrap .messagediv").first()).toBeVisible();
		await page.locator("#channels button.channelbutton", {hasText: GATED_VOICE.name}).click();
		const fetched: string[] = [];
		page.on("request", (request) => {
			if (request.url().includes(`/channels/${GATED_VOICE.id}/messages?`)) fetched.push(request.url());
		});

		await page.locator("#voiceArea .callVoiceIcon:has(.svg-frmessage)").click();

		await expect(page.locator("#scrollWrap")).toContainText(
			"This is a NSFW channel, do you wish to proceed?",
		);
		await expect(page.locator("#scrollWrap .messagediv")).toHaveCount(0);
		expect(fetched).toEqual([]);

		await page.getByRole("button", {name: "Yes"}).click();
		await expect(page.locator("#scrollWrap .messagediv").first()).toBeVisible();
	});
});

test("leaving a channel still loading for a voice channel takes its skeleton down", async ({
	page,
	mockInstance,
}) => {
	await page.route(`**/channels/${MOCK_CHANNEL.id}/messages?*`, () => {
		// Never answered: the channel is left while its fetch is still out.
	});
	await loginAndOpenChannel(page);
	voiceOn(mockInstance);
	await expect(page.locator("#loadingdiv")).toHaveClass(/loading/);

	await voiceRow(page).click();

	await expect(page.locator("#voiceArea .callVoiceIcon").first()).toBeVisible();
	await expect(page.locator("#loadingdiv")).not.toHaveClass(/loading/);
});
