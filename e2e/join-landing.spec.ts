import {expect, type Page} from "@playwright/test";
import {
	DESKTOP,
	joinOtherServer,
	loginAndOpenChannel,
	OTHER_GUILD_ID,
	test,
} from "./fixtures";

// The in-app joins (the pillar "+" dialog, an invite embed's Accept) open the guild like the
// invite page's fresh boot does: the sidebar switches AND a channel of the new guild opens.
// And a server clicked before the viewer's member lands must not leave the old channel's
// composer live — typing there sends to the channel the user navigated away from.

test.use({...DESKTOP});

/** The pillar "+" → join dialog → code submitted. The mock answers the join POST with
 * OTHER_GUILD_ID (see the join-other route in e2e/mock). */
async function joinViaDialog(page: Page) {
	await page.locator("#servers .svg-plus").click();
	await page.getByRole("button", {name: "Join a guild using an invite"}).click();
	await page
		.locator(".optionElement", {has: page.getByText("Invite link/code", {exact: true})})
		.locator("input")
		.fill("join-other");
	await page.getByRole("button", {name: "Submit", exact: true}).click();
}

test("joining a guild the session already knows lands in its channel", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	// The guild is already known (its GUILD_CREATE arrived earlier): the join's known arm.
	await joinOtherServer(page, mockInstance);
	await joinViaDialog(page);

	// The join must LAND in the guild: its URL and its channel (Discord's accept behavior),
	// not the old channel with a swapped sidebar.
	await expect(page).toHaveURL(new RegExp(`/channels/${OTHER_GUILD_ID}`));
	await expect(page.locator("#channelname")).toHaveText("#elsewhere");
});

test("joining a guild before its GUILD_CREATE lands in it when it arrives", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	// The join POST resolves before the guild exists: the wait-for-arrival arm.
	const joinAnswered = page.waitForResponse(
		(res) => new URL(res.url()).pathname === "/api/v9/invites/join-other",
	);
	await joinViaDialog(page);
	await joinAnswered;
	await joinOtherServer(page, mockInstance);

	await expect(page).toHaveURL(new RegExp(`/channels/${OTHER_GUILD_ID}`));
	await expect(page.locator("#channelname")).toHaveText("#elsewhere");
});

test("a server clicked before its member arrives shows a loading state, not the old channel", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	mockInstance.holdMembers = true;
	const icon = await joinOtherServer(page, mockInstance);
	const asked = () =>
		mockInstance.capturedRequests.filter(
			(r) =>
				r.method === "GET" && r.pathname.startsWith(`/api/v9/guilds/${OTHER_GUILD_ID}/members/`),
		).length;
	await expect.poll(asked).toBeGreaterThan(0);

	await icon.click();
	// While the member is on its way the old channel must stand down: the skeleton shows and
	// its composer takes no input (typing would send to the channel the user just left).
	await expect(page.locator("#loadingdiv")).toHaveClass(/loading/);
	await expect(page.locator("#typebox")).toHaveAttribute("contenteditable", "false");

	mockInstance.releaseMembers();
	await expect(page.locator("#channelname")).toHaveText("#elsewhere");
});

test("leaving for home during the member wait clears the loading state", async ({
	page,
	mockInstance,
}) => {
	await loginAndOpenChannel(page);
	mockInstance.holdMembers = true;
	const icon = await joinOtherServer(page, mockInstance);
	const memberAnswer = page.waitForResponse((res) =>
		new URL(res.url()).pathname.startsWith(`/api/v9/guilds/${OTHER_GUILD_ID}/members/`),
	);
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

	// The went-elsewhere exit must not leave the skeleton over the home page.
	await expect(page.locator("#loadingdiv")).not.toHaveClass(/loading/);
});
