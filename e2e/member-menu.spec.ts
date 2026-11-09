import {expect} from "@playwright/test";
import {
	DESKTOP,
	EN,
	MOCK_BOT_MEMBER,
	MOCK_BOT_USER,
	MOCK_CHANNEL_ID,
	MOCK_GUILD_ID,
	MOCK_MEMBER,
	MOCK_MESSAGES,
	MOCK_USER_ID,
	loginAndOpenChannel,
	permissionBits,
	test,
} from "./fixtures";
import type {memberjson, messagejson, rolesjson, userjson} from "../src/webpage/jsontypes";

// The member list's right-click menu (src/webpage/user.ts setUpContextMenu): moderation block,
// then roles, then copy-id, split by dividers, with the moderation rows in red. The unit pin
// (userMenuOrder.test.ts) reads the row array; this reads the rendered menu.
//
// The viewer must outrank the target (Member.canActOn) and the target must not hold
// MODERATE_MEMBERS itself (the Timeout row hides for a moderator), so the permissions ride on a
// viewer-only "Moderator" role rather than on @everyone's `extraEveryonePermissions`.

const MODERATOR_ROLE_ID = "1200000000000000401";
const MODERATOR_ROLE: rolesjson = {
	id: MODERATOR_ROLE_ID,
	guild_id: MOCK_GUILD_ID,
	name: "Moderator",
	color: 0,
	hoist: false,
	position: 1,
	permissions: permissionBits(["KICK_MEMBERS", "BAN_MEMBERS", "MODERATE_MEMBERS", "MANAGE_ROLES"]),
	managed: false,
	mentionable: false,
	icon: "",
	unicode_emoji: "",
	flags: 0,
};

const ALICE_ID = "1200000000000000004";
const ALICE: userjson = {...MOCK_BOT_USER, id: ALICE_ID, username: "Alice", bot: false};
const ALICE_MEMBER: memberjson = {...MOCK_BOT_MEMBER, id: ALICE_ID, user: ALICE};
const ALICE_MESSAGE: messagejson = {
	id: "1200000000000000310",
	channel_id: MOCK_CHANNEL_ID,
	guild_id: MOCK_GUILD_ID,
	author: ALICE,
	member: ALICE_MEMBER,
	content: "hello from Alice",
	timestamp: "2025-01-01T12:03:00.000Z",
	edited_timestamp: null,
	tts: false,
	mention_everyone: false,
	mentions: [],
	mention_roles: [],
	attachments: [],
	embeds: [],
	reactions: [],
	nonce: "e2e-nonce-member-menu",
	pinned: false,
	type: 0,
};

test.use({
	...DESKTOP,
	mockInstanceOptions: {
		extraRoles: [MODERATOR_ROLE],
		members: [{...MOCK_MEMBER, id: MOCK_USER_ID, roles: [MODERATOR_ROLE_ID]}, ALICE_MEMBER],
		messages: [ALICE_MESSAGE, ...MOCK_MESSAGES],
	},
});

test.beforeEach(({mockInstance}) => {
	// mount the mock's routes; the handle stays unread
	void mockInstance;
});

test("the member menu orders moderation, then roles, then copy-id, with dividers and red moderation rows", async ({
	page,
}) => {
	await loginAndOpenChannel(page);

	const aliceRow = page.locator("#sideDiv .memberListStyle", {hasText: "Alice"});
	await expect(aliceRow).toBeVisible();
	await aliceRow.click({button: "right"});
	const menu = page.locator(".contextmenu");
	await expect(menu).toBeVisible();

	// The rendered rows top to bottom: a button's label, "---" for a divider.
	const rows = () =>
		menu.evaluate((el) =>
			Array.from(el.children).map((child) =>
				child.tagName === "HR" ? "---" : (child.textContent ?? "").trim(),
			),
		);
	const {timeout, kick, ban, addRole, removeRole, copyId} = EN.user;
	// Wait for the member-dependent rows: the menu is built once member resolution settled.
	await expect(menu.getByRole("button", {name: timeout, exact: true})).toBeVisible();

	const seen = await rows();
	const start = seen.indexOf(timeout);
	expect(start, `Timeout row in ${JSON.stringify(seen)}`).toBeGreaterThan(-1);
	expect(seen.slice(start, start + 8), `rows after Timeout in ${JSON.stringify(seen)}`).toEqual([
		timeout,
		kick,
		ban,
		"---",
		addRole,
		removeRole,
		"---",
		copyId,
	]);

	// Red: the moderation rows resolve to what `color: "red"` sets (var(--red)), and the
	// non-moderation rows do not.
	const expectedRed = await page.evaluate(() => {
		const probe = document.createElement("span");
		probe.style.color = "var(--red)";
		document.body.append(probe);
		const color = getComputedStyle(probe).color;
		probe.remove();
		return color;
	});
	const colorOf = (name: string) =>
		menu.getByRole("button", {name, exact: true}).evaluate((el) => getComputedStyle(el).color);
	const plain = await colorOf(copyId);
	expect(plain, "a non-moderation row is not red").not.toBe(expectedRed);
	expect(await colorOf(addRole), "Add roles is not red").toBe(plain);
	for (const name of [timeout, kick, ban]) {
		expect(await colorOf(name), `"${name}" renders red`).toBe(expectedRed);
	}
});
