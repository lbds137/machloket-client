import {describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {I18n} = await import("./i18n");
await I18n.done;

/** One unread guild channel whose preview is one cached message. */
function session() {
	const guild = {id: "g1", channels: [] as unknown[], properties: {name: "G"}};
	const messages = new Map<string, unknown>();
	const message = {
		id: "m1",
		guild,
		content: {rawString: "hello"},
		mentionsuser: () => false,
		giveData(d: {content?: string}) {
			if (typeof d.content === "string") message.content = {rawString: d.content};
		},
		deleteEvent() {
			messages.delete("m1");
		},
	};
	messages.set("m1", message);
	const channel = {
		id: "c1",
		name: "general",
		guild,
		visible: true,
		hasunreads: true,
		mentions: 1,
		lastmessageid: "m1",
		trueLastMessageid: "m1",
		lastreadmessageid: "0",
		lastmessage: undefined,
		idToNext: new Map([["0", "m1"]]),
		messages,
		// Like the real fetch: a deleted message is gone, not resurrected.
		getmessage: async (id: string) => messages.get(id),
	};
	guild.channels.push(channel as never);
	const lu = Object.assign(Object.create(Localuser.prototype), {
		guildids: new Map([["@me", {channels: []}]]),
		guilds: [guild],
		channelids: new Map([["c1", channel]]),
		generateFavicon: () => {},
		// Instance fields the render's token check needs (a prototype-only stub has no them).
		inboxTab: "unread" as const,
		inboxBuildToken: 0,
	}) as InstanceType<typeof Localuser>;
	// The render entry points are private; cast the surface, don't redeclare it (a private
	// redeclaration in an intersection collapses the type to never).
	const internals = lu as unknown as {
		inboxMenu?: HTMLDivElement;
		renderInboxMenu: (tab: "unread", menu: HTMLDivElement, keepVisible?: boolean) => Promise<void>;
	};
	return {lu, internals, message, channel};
}

const event = (t: string, d: Record<string, unknown>) => ({op: 0, t, s: 1, d});

describe("the open inbox's preview", () => {
	it("refreshes when the preview message is edited", async () => {
		const {lu, internals} = session();
		const menu = document.createElement("div");
		document.body.append(menu);
		internals.inboxMenu = menu;
		await internals.renderInboxMenu("unread", menu);
		expect(menu.textContent).toContain("hello");

		await lu.handleEvent(event("MESSAGE_UPDATE", {id: "m1", channel_id: "c1", content: "edited"}) as never);
		await vi.waitFor(() => expect(menu.textContent).toContain("edited"));
	});

	it("refreshes when the preview message is deleted", async () => {
		const {lu, internals} = session();
		const menu = document.createElement("div");
		document.body.append(menu);
		internals.inboxMenu = menu;
		await internals.renderInboxMenu("unread", menu);
		expect(menu.textContent).toContain("hello");

		await lu.handleEvent(event("MESSAGE_DELETE", {id: "m1", channel_id: "c1"}) as never);
		await vi.waitFor(() => expect(menu.textContent).toContain(I18n.inbox.openChannel()));
	});
});
