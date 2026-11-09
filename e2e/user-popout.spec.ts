import {expect, type Locator, type Page} from "@playwright/test";
import {MOCK_BOT_MEMBER, MOCK_GUILD_ID, loginAndOpenChannel, test} from "./fixtures";
import type {rolesjson} from "../src/webpage/jsontypes";

// The user popout on a phone (src/webpage/user.ts buildprofile): the phone stylesheet makes it a
// bottom sheet whatever the tap position (style.css, `.profile`); a member's bio renders its
// role mention against the guild, and a guild nick is the name shown.
//
// The role id is digits only: the markdown mention reads `<@&digits>` (popoutRoles.test.ts).
const KNIGHTS_ID = "1200000000000000402";
const KNIGHTS: rolesjson = {
	id: KNIGHTS_ID,
	guild_id: MOCK_GUILD_ID,
	name: "Knights",
	color: 0xaa0000,
	hoist: false,
	position: 1,
	permissions: "0",
	managed: false,
	mentionable: true,
	icon: "",
	unicode_emoji: "",
	flags: 0,
};

test.use({
	mockInstanceOptions: {
		extraRoles: [KNIGHTS],
		members: [
			{
				...MOCK_BOT_MEMBER,
				nick: "Helper Nick",
				bio: `Ask <@&${KNIGHTS_ID}> for help`,
				roles: [KNIGHTS_ID],
			},
		],
	},
});

test.beforeEach(async ({mockInstance, page}) => {
	// mount the mock's routes; the handle stays unread
	void mockInstance;
	// A bot popout asks sbar.fyi's bot catalog for its explorer card: an empty catalog is the answer.
	await page.route("https://sbar.fyi/api/catalog/bots", (route) => route.fulfill({json: []}));
});

/** The avatar of the message group whose text is `text`. */
const avatarOf = (page: Page, text: string) =>
	page.locator(".messagediv", {hasText: text}).locator(".pfprow img.pfp").first();

/** Taps `avatar` and returns the popout once its async rows (roles, bio) have landed. */
async function openPopout(page: Page, avatar: Locator): Promise<Locator> {
	await avatar.scrollIntoViewIfNeeded();
	await avatar.tap();
	const popout = page.locator(".profile");
	await expect(popout).toBeVisible();
	await expect(popout.locator(".rolesbox")).toBeAttached();
	return popout;
}

test("the popout is a bottom sheet spanning a 412px phone, wherever the avatar was", async ({
	page,
}) => {
	await loginAndOpenChannel(page);
	const viewport = page.viewportSize()!;
	expect(viewport.width).toBe(412);

	const popout = await openPopout(page, avatarOf(page, "Choose a notification role:"));
	// Polled: the popout's rows land after it opened, and the box settles last.
	await expect
		.poll(async () => {
			const box = (await popout.boundingBox())!;
			return {
				left: Math.round(box.x),
				width: Math.round(box.width),
				bottom: Math.round(box.y + box.height),
				topOnScreen: box.y >= 0,
			};
		}, "the sheet's edges")
		.toEqual({left: 0, width: viewport.width, bottom: viewport.height, topOnScreen: true});
});

test("a member's bio shows its role mention as @RoleName, and the nick is the name shown", async ({
	page,
}) => {
	await loginAndOpenChannel(page);
	const popout = await openPopout(page, avatarOf(page, "Choose a notification role:"));

	await expect(popout.locator(".mentionMD")).toHaveText("@Knights");
	await expect(popout.locator(".rolediv")).toHaveText("Knights");
	await expect(popout.locator("h2")).toContainText("Helper Nick");
	await expect(popout.locator("h2")).not.toContainText("HelperBot");
});
