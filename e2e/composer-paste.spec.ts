import {expect} from "@playwright/test";
import type {messagejson} from "../src/webpage/jsontypes";
import {
	DESKTOP,
	MOCK_BOT_MEMBER,
	MOCK_BOT_USER,
	MOCK_BOT_USER_ID,
	MOCK_CHANNEL_ID,
	MOCK_GUILD_ID,
	MOCK_INSTANCE_ORIGIN,
	MOCK_MESSAGES,
	expectRequests,
	loginAndOpenChannel,
	test,
} from "./fixtures";

// Copying a message in this client and pasting it into the composer keeps its mention and
// custom emoji as sent syntax (MarkDown.rememberCopy / pastedText), though the browser's own
// clipboard text only carries the labels. linkSafety.test.ts pins the pair with a faked
// clipboard event; this runs the real copy, the real clipboard and a keyboard paste.
const EMOJI_ID = "1200000000000000500";
const COPIED = `look <@${MOCK_BOT_USER_ID}> <:wave:${EMOJI_ID}>`;
const SOURCE_MESSAGE: messagejson = {
	id: "1200000000000000312",
	channel_id: MOCK_CHANNEL_ID,
	guild_id: MOCK_GUILD_ID,
	author: MOCK_BOT_USER,
	member: MOCK_BOT_MEMBER,
	content: COPIED,
	timestamp: "2025-01-01T12:04:00.000Z",
	edited_timestamp: null,
	tts: false,
	mention_everyone: false,
	mentions: [],
	mention_roles: [],
	attachments: [],
	embeds: [],
	reactions: [],
	nonce: "e2e-nonce-paste",
	pinned: false,
	type: 0,
};

test.use({...DESKTOP, mockInstanceOptions: {messages: [SOURCE_MESSAGE, ...MOCK_MESSAGES]}});

test.beforeEach(({mockInstance}) => {
	// mount the mock's routes; the handle stays unread
	void mockInstance;
});

test("a message copied in the page pastes into the composer with its mention and emoji intact", async ({
	page,
	context,
	mockInstance,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"], {
		origin: MOCK_INSTANCE_ORIGIN,
	});
	await loginAndOpenChannel(page);

	// The message as the page shows it: a mention chip and an emoji image.
	const mention = page.locator("#scrollWrap .mentionMD", {hasText: "@HelperBot"});
	await expect(mention).toBeVisible();
	const emoji = page.locator("#scrollWrap img.md-emoji");
	await expect(emoji).toHaveCount(1);

	// Select the message's text through the page and copy it with the keyboard.
	await mention.evaluate((el) => {
		const range = document.createRange();
		range.selectNodeContents(el.parentElement!);
		const selection = getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
	});
	await page.keyboard.press("Control+C");

	// The browser's own clipboard text has labels where the syntax was: that is the premise.
	const readClipboard = () => page.evaluate(() => navigator.clipboard.readText());
	await expect.poll(readClipboard, "the clipboard holds what the page showed").toContain("@HelperBot");
	expect(await readClipboard()).not.toContain(`<@${MOCK_BOT_USER_ID}>`);

	const typebox = page.locator("#typebox");
	await typebox.click();
	await page.keyboard.press("Control+V");
	await page.keyboard.press("Enter");

	const isSend = (req: {method: string; pathname: string}) =>
		req.method === "POST" && req.pathname === `/api/v9/channels/${MOCK_CHANNEL_ID}/messages`;
	const [send] = await expectRequests(mockInstance, isSend, 1);
	const content = (send.body as {content: string}).content;
	expect(content).toContain(`<@${MOCK_BOT_USER_ID}>`);
	expect(content).toContain(`<:wave:${EMOJI_ID}>`);
	expect(content.replace(/\s+/g, " ").trim()).toBe(COPIED);
});
