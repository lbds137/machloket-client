import {afterEach, beforeEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {I18n} = await import("./i18n");

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
	for (const id of ["scrollWrap", "typebox", "upload", "typediv", "sideDiv"]) {
		document.getElementById(id)?.remove();
	}
});

/** The minimal DOM nsfwPannel touches, plus a channel whose nsfw_allowed and
 * perminfo are set directly: localuser and perminfo are getters on Channel
 * (Object.assign cannot write them), so they land via defineProperty. */
function panelChannel(nsfwAllowed: boolean | null | undefined) {
	for (const id of ["scrollWrap", "typebox", "upload", "typediv", "sideDiv"]) {
		const el = document.createElement("div");
		el.id = id;
		document.body.append(el);
	}
	const localuser: {user: {nsfw_allowed: boolean | null | undefined}; channelfocus?: unknown} = {
		user: {nsfw_allowed: nsfwAllowed},
	};
	const channel = Object.assign(Object.create(Channel.prototype), {
		nsfw: true,
	}) as InstanceType<typeof Channel>;
	Object.defineProperty(channel, "localuser", {value: localuser, writable: true, configurable: true});
	Object.defineProperty(channel, "perminfo", {value: {nsfwOk: false}, writable: true, configurable: true});
	// The Yes handler clears channelfocus before refetching; start it set so the clear is observable.
	localuser.channelfocus = channel;
	return channel;
}

function panelDom() {
	const panel = document.querySelector("#scrollWrap .messagecontainer");
	expect(panel, "nsfwPannel must leave its panel in the scroll wrap").not.toBeNull();
	return {
		titles: Array.from(panel!.querySelectorAll("h2")).map((h) => h.textContent),
		buttons: Array.from(panel!.querySelectorAll("button")),
	};
}

it("a server-declined user gets the not-allowed panel with a way back", () => {
	const channel = panelChannel(false);
	const back = vi.spyOn(window.history, "back").mockImplementation(() => {});

	channel.nsfwPannel();

	const {titles, buttons} = panelDom();
	expect(titles).toContain(I18n.channel.notAllowed());
	const backButtons = buttons.filter((b) => b.textContent === I18n.forum.back());
	expect(backButtons.length, "the declined panel must not dead-end").toBe(1);
	backButtons[0].click();
	expect(back).toHaveBeenCalledTimes(1);
});

it("an unknown nsfw_allowed gets the back-only panel, not an ask it could never pass", () => {
	const channel = panelChannel(null);

	channel.nsfwPannel();

	const {titles, buttons} = panelDom();
	// The shipped gate matrix keeps unknown values gated regardless of perminfo.nsfwOk
	// (channelNsfwAction), so an ask's Yes could never load the channel.
	expect(titles).toContain(I18n.channel.notAllowed());
	const backButtons = buttons.filter((b) => b.textContent === I18n.forum.back());
	expect(backButtons.length).toBe(1);
	expect(buttons.map((b) => b.textContent)).not.toContain(I18n.yes());
});

it("an undefined nsfw_allowed behaves like null", () => {
	const channel = panelChannel(undefined);

	channel.nsfwPannel();

	const {titles, buttons} = panelDom();
	expect(titles).toContain(I18n.channel.notAllowed());
	const backButtons = buttons.filter((b) => b.textContent === I18n.forum.back());
	expect(backButtons.length).toBe(1);
	expect(buttons.map((b) => b.textContent)).not.toContain(I18n.yes());
});

it("the ask's Yes confirms per-session and loads the channel", () => {
	const channel = panelChannel(true);
	const getHTML = vi.spyOn(channel, "getHTML").mockResolvedValue(undefined);

	channel.nsfwPannel();

	const {titles, buttons} = panelDom();
	expect(titles).toContain(I18n.channel.nsfwAsk());
	const yes = buttons.find((b) => b.textContent === I18n.yes());
	expect(yes).not.toBeUndefined();
	yes!.click();
	expect((channel as unknown as {perminfo: {nsfwOk: boolean}}).perminfo.nsfwOk).toBe(true);
	expect((channel as unknown as {localuser: {channelfocus?: unknown}}).localuser.channelfocus).toBeUndefined();
	expect(getHTML).toHaveBeenCalledWith(true, true);
});

it("an allowed user with the block action gets the blocked panel and a way back", () => {
	localStorage.setItem("userPreferences", JSON.stringify({nsfwAction: "block"}));
	const channel = panelChannel(true);
	const back = vi.spyOn(window.history, "back").mockImplementation(() => {});

	channel.nsfwPannel();

	const {titles, buttons} = panelDom();
	expect(titles).toContain(I18n.channel.nsfwBlocked());
	const backButtons = buttons.filter((b) => b.textContent === I18n.forum.back());
	expect(backButtons.length).toBe(1);
	backButtons[0].click();
	expect(back).toHaveBeenCalledTimes(1);
});
