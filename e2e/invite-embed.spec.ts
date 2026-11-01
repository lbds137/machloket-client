import {expect} from "@playwright/test";
import type {embedjson, messagejson} from "../src/webpage/jsontypes";
import {
	EN,
	MOCK_BOT_MEMBER,
	MOCK_BOT_USER,
	MOCK_BOT_USER_ID,
	MOCK_CHANNEL_ID,
	MOCK_GUILD_ID,
	MOCK_INVITE,
	MOCK_MESSAGES,
	loginAndOpenChannel,
	test,
} from "./fixtures";

// An invite embed to another instance (src/webpage/embed.ts generateInvite): the preview is
// fetched from the instance the link names, so it waits for a tap - until then nothing
// contacts that host and the card only names it. linkSafety.test.ts pins the unit; this runs
// the built card. "spacebar.chat" is the mock's bundled second instance-list entry, which is
// what makes the link an invite embed at all (Embed.getType matches a known instance's host).
const OTHER_HOST = "spacebar.chat";
const OTHER_ORIGIN = `https://${OTHER_HOST}`;
const INVITE_CODE = "far-away";

const INVITE_EMBED = {type: "link", url: `${OTHER_ORIGIN}/invite/${INVITE_CODE}`} as embedjson;
const INVITE_MESSAGE: messagejson = {
	id: "1200000000000000311",
	channel_id: MOCK_CHANNEL_ID,
	guild_id: MOCK_GUILD_ID,
	author: MOCK_BOT_USER,
	member: MOCK_BOT_MEMBER,
	content: "",
	timestamp: "2025-01-01T12:03:00.000Z",
	edited_timestamp: null,
	tts: false,
	mention_everyone: false,
	mentions: [],
	mention_roles: [],
	attachments: [],
	embeds: [INVITE_EMBED],
	reactions: [],
	nonce: "e2e-nonce-invite-embed",
	pinned: false,
	type: 0,
};

test.use({mockInstanceOptions: {messages: [INVITE_MESSAGE, ...MOCK_MESSAGES]}});

test.beforeEach(({mockInstance}) => {
	// mount the mock's routes; the handle stays unread
	void mockInstance;
});

test("an invite to another instance contacts it only after a tap", async ({page}) => {
	// The other instance, answered by this spec: the shared net aborts anything that leaves
	// the preview server, and a page-level route is matched first.
	const contacted: string[] = [];
	await page.route(`${OTHER_ORIGIN}/**`, async (route) => {
		const {pathname} = new URL(route.request().url());
		contacted.push(pathname);
		if (pathname === "/.well-known/spacebar/client") {
			return route.fulfill({
				json: {
					api: {baseUrl: OTHER_ORIGIN, apiVersions: {default: "9"}},
					gateway: {baseUrl: `wss://${OTHER_HOST}`, encoding: ["json"], compression: ["zlib-stream"]},
					cdn: {baseUrl: OTHER_ORIGIN},
				},
			});
		}
		if (pathname === `/api/v9/invites/${INVITE_CODE}`) {
			return route.fulfill({
				json: {
					...MOCK_INVITE,
					code: INVITE_CODE,
					guild: {...MOCK_INVITE.guild, id: "1300000000000000100", name: "Far Away Guild"},
					inviter: {id: MOCK_BOT_USER_ID, username: "HelperBot"},
				},
			});
		}
		return route.fulfill({status: 404, json: {}});
	});

	await loginAndOpenChannel(page);
	const card = page.locator(".inviteEmbed");
	await expect(card).toBeVisible();

	// Before the tap: the card names the host and offers the preview; nothing was fetched.
	await expect(card).toContainText(EN.invite.otherInstance.replace("$1", OTHER_HOST));
	const show = card.getByRole("button", {name: EN.invite.showPreview, exact: true});
	await expect(show).toBeVisible();
	expect(contacted, "no request reaches the other instance before the tap").toEqual([]);

	await show.tap();

	// After it: the instance is asked, and the preview replaces the prompt.
	await expect(card).toContainText("Far Away Guild");
	await expect(card.getByRole("button", {name: EN.invite.accept, exact: true})).toBeVisible();
	await expect(card).not.toContainText(EN.invite.showPreview);
	expect(contacted).toContain("/.well-known/spacebar/client");
	expect(contacted).toContain(`/api/v9/invites/${INVITE_CODE}`);
});
