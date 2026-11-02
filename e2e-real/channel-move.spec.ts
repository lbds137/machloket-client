import type {Page} from "@playwright/test";
import {
	DESKTOP,
	channelRowText,
	expect,
	logIn,
	newAccount,
	rest,
	test,
	type RealAccount,
} from "./fixtures";

test.use(DESKTOP);

type Channel = {id: string; name: string; type: number; parent_id: string | null; position: number};

async function setUp(owner: RealAccount) {
	const guild = await rest<{id: string}>(owner.token, "POST", "/guilds", {name: "Movers"});
	const make = (name: string, type: number, parent_id?: string) =>
		rest<Channel>(owner.token, "POST", `/guilds/${guild.id}/channels`, {name, type, parent_id});
	const catA = await make("Cat A", 4);
	const catB = await make("Cat B", 4);
	const a1 = await make("a-one", 0, catA.id);
	const a2 = await make("a-two", 0, catA.id);
	const b1 = await make("b-one", 0, catB.id);
	const b2 = await make("b-two", 0, catB.id);
	return {guild, catA, catB, a1, a2, b1, b2};
}

/** The sidebar's rows under each category, top to bottom (a thread counts as a row). */
function sidebarRows(page: Page): Promise<Record<string, string[]>> {
	return page.evaluate(() => {
		const out: Record<string, string[]> = {};
		for (const name of document.querySelectorAll("#channels .capsflex p2")) {
			const category = name.closest(".capsflex")!.parentElement!;
			out[name.textContent!.trim()] = [
				...category.querySelectorAll(":scope > .channels button.channelbutton"),
			].map((b) => b.textContent!.trim());
		}
		return out;
	});
}

async function openChannelMenu(page: Page, name: string): Promise<void> {
	await page
		.locator("#channels button.channelbutton", {hasText: channelRowText(name)})
		.click({button: "right"});
	await expect(page.locator(".contextmenu")).toBeVisible();
}

test("Move to lands a channel at the end of the target category, on the server and in the sidebar", async ({
	page,
}) => {
	const owner = await newAccount("mover");
	const {guild, catB, a1, a2} = await setUp(owner);

	await logIn(page, owner);
	await page.locator("#servers .blankserver.servericon").first().click();
	await expect(page.locator("#channels button.channelbutton", {hasText: "a-one"})).toBeVisible();
	const before = await sidebarRows(page);
	expect([...before["Cat A"]].sort()).toEqual(["a-one", "a-two"]);
	expect([...before["Cat B"]].sort()).toEqual(["b-one", "b-two"]);

	await openChannelMenu(page, "a-one");
	await page.locator(".contextmenu").getByText("Move to…", {exact: true}).click();
	const dialog = page.locator(".dialogModal", {has: page.getByText("Move to…", {exact: true})});
	await dialog.getByLabel("Cat B", {exact: true}).check();
	const reorder = page.waitForResponse(
		(res) =>
			res.request().method() === "PATCH" && res.url().endsWith(`/guilds/${guild.id}/channels`),
	);
	await dialog.getByRole("button", {name: "Submit", exact: true}).click();
	const reordered = await reorder;
	expect(reordered.status(), "the reorder the client sends").toBeLessThan(300);

	// The sidebar redraws at once: no reload, the moved channel last under Cat B.
	await expect
		.poll(() => sidebarRows(page))
		.toEqual({"Cat A": ["a-two"], "Cat B": [...before["Cat B"], "a-one"]});

	// And the server holds it: the new parent, after both existing members of the category.
	await expect
		.poll(async () => {
			const all = await rest<Channel[]>(owner.token, "GET", `/guilds/${guild.id}/channels`);
			const byId = new Map(all.map((c) => [c.id, c]));
			const moved = byId.get(a1.id)!;
			const inTarget = all.filter((c) => c.parent_id === catB.id && c.id !== a1.id);
			return {
				parent: moved.parent_id,
				last: inTarget.length === 2 && inTarget.every((c) => moved.position > c.position),
				stayed: byId.get(a2.id)!.parent_id,
			};
		})
		.toEqual({parent: catB.id, last: true, stayed: a2.parent_id});
});

test("a plain member's channel menu has no Move to, and neither has a thread's", async ({
	page,
	extraPage,
}) => {
	const owner = await newAccount("mover");
	const {a1, a2} = await setUp(owner);
	await rest(owner.token, "POST", `/channels/${a2.id}/threads`, {
		name: "side-thread",
		type: 11,
	});
	const invite = await rest<{code: string}>(owner.token, "POST", `/channels/${a1.id}/invites`, {});
	const member = await newAccount("plain");
	await rest(member.token, "POST", `/invites/${invite.code}`, {});
	const menu = (p: Page) => p.locator(".contextmenu");

	// The owner: a channel's menu has Move to (the control), the thread's has the rest but not it.
	await logIn(page, owner);
	await page.locator("#servers .blankserver.servericon").first().click();
	await expect(
		page.locator("#channels button.channelbutton", {hasText: "side-thread"}),
	).toBeVisible();
	await openChannelMenu(page, "a-two");
	await expect(menu(page).getByText("Move to…", {exact: true})).toBeVisible();
	await page.mouse.click(1, 1);
	await expect(menu(page)).toHaveCount(0);
	await openChannelMenu(page, "side-thread");
	await expect(menu(page).getByText("Mute channel", {exact: true})).toBeVisible();
	await expect(menu(page).getByText("Move to…", {exact: true})).toHaveCount(0);

	// A plain member: a menu with entries of its own, none of them Move to.
	const memberPage = await extraPage();
	await logIn(memberPage, member);
	await memberPage.locator("#servers .blankserver.servericon").first().click();
	await expect(
		memberPage.locator("#channels button.channelbutton", {hasText: "b-one"}),
	).toBeVisible();
	await openChannelMenu(memberPage, "b-one");
	await expect(menu(memberPage).getByText("Mute channel", {exact: true})).toBeVisible();
	await expect(menu(memberPage).getByText("Move to…", {exact: true})).toHaveCount(0);
});
