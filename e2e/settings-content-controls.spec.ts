import {expect, type Page} from "@playwright/test";
import {MOCK_CHANNEL_ID, MOCK_GUILD_ID, MOCK_NSFW_CHANNEL_ID, MOCK_SPOILER_MESSAGE, loginAndOpenChannel, test} from "./fixtures";

test.use({viewport: {width: 1280, height: 800}});
// The spoiler message rides THIS spec's own mount (mockInstanceOptions), not the
// shared MOCK_MESSAGES — shared #general layout stays byte-identical for every
// other spec (the icons.spec drawer click loses its hit-test to layout shifts).
test.use({mockInstanceOptions: {messages: [MOCK_SPOILER_MESSAGE]}});

// S4: the Privacy card's sensitive-content selects must drive the enforcement paths
// (spoiler covers on attachments/components, the NSFW channel gate), not just persist.
// Defaults are blur — the out-of-box behavior stays today's covered/asked parity.
// Transitions re-boot into a channel deep link: the enforcement points read the stored
// action at render time, and a plain reload parks the guild view half-booted (the
// settings URL survives it).

async function openPrivacyCard(page: Page) {
	await page.locator("#settings").click();
	await expect(page.locator(".settingbuttons")).toBeVisible();
	const privacyLink = page.locator('.settingbuttons .cardLink[data-section="Your account"]', {
		hasText: "Privacy",
	});
	await privacyLink.click();
	const card = page.locator("#card-privacy");
	await expect(card).toBeVisible();
	return card;
}

async function setActionAndBoot(page: Page, channelId: string, row: string, label: string) {
	const card = await openPrivacyCard(page);
	await card
		.locator(".optionElement", {hasText: row})
		.locator("select")
		.selectOption({label});
	await page.goto(`/channels/${MOCK_GUILD_ID}/${channelId}`);
	await expect(page.locator("#loading")).toHaveClass(/doneloading/, {timeout: 15_000});
}

test("spoiler media: covered by default, a placeholder on block, raw on show", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await loginAndOpenChannel(page);
	const spoiler = page.locator(".messagediv").filter({hasText: "here, one spoiler:"});

	// Default (blur): the cover stands over the attachment.
	await expect(spoiler.locator("img.messageimg")).toHaveCount(1);
	await expect(spoiler.locator(".fSpoil")).toHaveCount(1);

	await setActionAndBoot(page, MOCK_CHANNEL_ID, "Spoiler-tagged content", "Block");
	await expect(spoiler.locator(".fSpoilBlocked")).toHaveCount(1);
	await expect(spoiler.locator("img.messageimg")).toHaveCount(0);

	await setActionAndBoot(page, MOCK_CHANNEL_ID, "Spoiler-tagged content", "Show");
	await expect(spoiler.locator("img.messageimg")).toHaveCount(1);
	await expect(spoiler.locator(".fSpoil")).toHaveCount(0);
});

test("nsfw channel: the default asks, block refuses, show opens for an allowed account", async ({
	page,
	mockInstance,
}) => {
	void mockInstance;
	await loginAndOpenChannel(page);
	// loginAndOpenChannel leaves the channel drawer open on phone.
	const afterDark = page.locator("#channels button.channelbutton", {hasText: "after-dark"});

	// Default (blur): the ask panel stands in for the channel until confirmed.
	await afterDark.click();
	await expect(page.locator("#scrollWrap")).toContainText(
		"This is a NSFW channel, do you wish to proceed?",
	);
	await page.getByRole("button", {name: "Yes"}).click();
	// Accepting the ask must actually load the channel (the panel path historically
	// re-rendered without the message fetch and left the channel empty).
	await expect(page.getByText("here, one spoiler:", {exact: true})).toBeVisible();
	await expect(page.locator("#typebox")).toHaveAttribute("contenteditable", "plaintext-only");

	await setActionAndBoot(page, MOCK_NSFW_CHANNEL_ID, "NSFW content", "Block");
	await expect(page.locator("#channelname")).toHaveText("#after-dark");
	await expect(page.locator("#scrollWrap")).toContainText(
		"NSFW channels are blocked in your settings.",
	);
	await expect(page.getByRole("button", {name: "Yes"})).toHaveCount(0);
	await expect(page.locator("#typebox")).toHaveAttribute("contenteditable", "false");

	await setActionAndBoot(page, MOCK_NSFW_CHANNEL_ID, "NSFW content", "Show");
	await expect(page.locator("#channelname")).toHaveText("#after-dark");
	await expect(page.getByText("here, one spoiler:", {exact: true})).toBeVisible();
	await expect(page.locator("#typebox")).toHaveAttribute("contenteditable", "plaintext-only");
});
