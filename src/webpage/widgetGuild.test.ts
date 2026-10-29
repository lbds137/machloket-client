import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {User} = await import("./user");
const {Member} = await import("./member");
const {I18n} = await import("./i18n");

// Button labels hydrate asynchronously; drive the widget only once they have landed.
await I18n.done;

afterEach(() => {
	vi.restoreAllMocks();
});

/** The widget's avatar slot: a wrapper whose first child is the image the found-member
 * branch rewrites. */
function pfpSlot() {
	const wrapper = document.createElement("div");
	wrapper.append(document.createElement("img"));
	return wrapper;
}

/** A user whose widget plumbing (avatar, status binding, member name) is stubbed; the
 * member resolution itself is what the pins observe. */
function widgetUser(meGuild: {id: string}) {
	const pfp = pfpSlot();
	const user = Object.assign(Object.create(User.prototype), {
		owner: {guildids: new Map([["@me", meGuild]])},
		username: "Widgeted",
		bind: () => {},
		buildpfp: () => pfp,
		subName: () => {},
	}) as InstanceType<typeof User>;
	return {pfp, user};
}

it("the widget keeps its layout classes (the chip look lives in .createdWebhook)", () => {
	const {user} = widgetUser({id: "@me"});
	const div = user.createWidget({id: "@me"} as never);
	// flexltr rows the avatar and name; createdWebhook carries the chip styling. Both were
	// once lost to an edit slip — pinned so the loss reddens here instead of on screen.
	expect(div.classList.contains("flexltr")).toBe(true);
	expect(div.classList.contains("createdWebhook")).toBe(true);
});

it("createWidget resolves the member in the guild the caller passed", async () => {
	const meGuild = {id: "@me"};
	const passedGuild = {id: "777"};
	const {user} = widgetUser(meGuild);
	const spy = vi.spyOn(Member, "resolveMember").mockResolvedValue(undefined);

	user.createWidget(passedGuild as never);
	await new Promise((r) => setTimeout(r, 0));

	expect(spy).toHaveBeenCalledWith(user, passedGuild);
});

it("a member the guild doesn't know gets the not-found note, not silence", async () => {
	const passedGuild = {id: "777"};
	const {user} = widgetUser({id: "@me"});
	vi.spyOn(Member, "resolveMember").mockResolvedValue(undefined);

	const div = user.createWidget(passedGuild as never);
	await new Promise((r) => setTimeout(r, 0));

	expect(div.textContent).toContain(I18n.webhooks.notFound());
});

it("a resolved member names the widget (the control)", async () => {
	const {pfp, user} = widgetUser({id: "@me"});
	vi.spyOn(Member, "resolveMember").mockResolvedValue({
		name: "Guild Named",
		subName: () => {},
		getpfpsrc: () => "http://pfp.test/guild.png",
	} as never);

	const div = user.createWidget({id: "@me"} as never);
	await new Promise((r) => setTimeout(r, 0));

	expect(div.querySelector("b")?.textContent).toBe("Guild Named");
	expect((pfp.children[0] as HTMLImageElement).src).toContain("http://pfp.test/guild.png");
});
