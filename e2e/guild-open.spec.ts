import {expect, type Page} from "@playwright/test";
import type {channeljson} from "../src/webpage/jsontypes";
import {DESKTOP, loginAndOpenChannel, test} from "./fixtures";
import {MOCK_CHANNEL, MOCK_GUILD, type MockInstanceHandle} from "./mock";

// A server opened while the viewer's own member in it is still on its way: until the member
// lands every channel reads invisible, so what opens must wait for it.
const OTHER_GUILD_ID = "1200000000000000106";
const OTHER_CHANNEL: channeljson = {
	...MOCK_CHANNEL,
	id: "1200000000000000206",
	guild_id: OTHER_GUILD_ID,
	name: "elsewhere",
	topic: "",
	position: 5,
};

test.use({...DESKTOP});

/** A server joined mid-session (GUILD_CREATE), with OTHER_CHANNEL as its one channel. */
async function joinOtherServer(page: Page, mockInstance: MockInstanceHandle) {
	mockInstance.sendGatewayEvent({
		op: 0,
		t: "GUILD_CREATE",
		d: {
			...MOCK_GUILD,
			id: OTHER_GUILD_ID,
			properties: {...MOCK_GUILD.properties, id: OTHER_GUILD_ID, name: "Other Place", icon: null},
			// @everyone's role has the guild's id, and it's what lets the member see the channel.
			roles: MOCK_GUILD.roles.map((role) => ({
				...role,
				id: OTHER_GUILD_ID,
				guild_id: OTHER_GUILD_ID,
			})),
			channels: [OTHER_CHANNEL],
		},
	});
	const icon = page.locator("#servers .blankserver", {hasText: "OP"});
	await expect(icon).toBeVisible();
	return icon;
}

test("a server opened before its member arrives opens its channel once the member does", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	mockInstance.holdMembers = true;
	const icon = await joinOtherServer(page, mockInstance);
	// A guild built mid-session isn't registered yet when its constructor resolves the member,
	// so the lookup goes over REST (localuser.ts resolvemember).
	const asked = () =>
		mockInstance.capturedRequests.filter(
			(r) =>
				r.method === "GET" && r.pathname.startsWith(`/api/v9/guilds/${OTHER_GUILD_ID}/members/`),
		).length;
	// The member is asked for, and the answer is held: the click lands before it.
	await expect.poll(asked).toBeGreaterThan(0);

	await icon.click();
	mockInstance.releaseMembers();

	await expect(page.locator("#channelname")).toHaveText("#" + OTHER_CHANNEL.name);
	await expect(
		page.locator("#channels button.channelbutton", {hasText: OTHER_CHANNEL.name}),
	).toHaveCount(1);
});

test("a server left before its member arrives doesn't pull the user back when it does", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	mockInstance.holdMembers = true;
	const icon = await joinOtherServer(page, mockInstance);
	const memberAnswer = page.waitForResponse((res) =>
		new URL(res.url()).pathname.startsWith(`/api/v9/guilds/${OTHER_GUILD_ID}/members/`),
	);
	// Installed before the member is released. Nothing on screen marks the member landing on a
	// guild no longer open, so the wait is the app's own announcement: "guildmemberready"
	// fires as a macrotask after every memberReady awaiter has run — the went-elsewhere
	// decision included — so once it does, what follows can prove nothing moved.
	const memberSettled = page.evaluate(
		(guildId) =>
			new Promise<string>((done) => {
				const listener = (event: Event) => {
					if ((event as CustomEvent<{guildId: string}>).detail.guildId === guildId) {
						document.removeEventListener("guildmemberready", listener);
						done(guildId);
					}
				};
				document.addEventListener("guildmemberready", listener);
			}),
		OTHER_GUILD_ID,
	);

	await icon.click();
	await page.locator("#servers .home").first().click();
	await expect(page).toHaveURL(/\/channels\/@me/);
	mockInstance.releaseMembers();
	await memberAnswer;
	await memberSettled;

	await expect(page).toHaveURL(/\/channels\/@me/);
	await expect(page.locator("#channelname")).not.toHaveText("#" + OTHER_CHANNEL.name);
});
