import {expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {I18n} = await import("./i18n");
await I18n.done;

/** Renders the registered channel menu rows for a stubbed channel and returns their labels. */
function menuLabels(channel: InstanceType<typeof Channel>): string[] {
	const menu = document.createElement("div");
	for (const part of Channel.contextmenu.buttons) {
		part.makeContextHTML(channel, undefined, menu, [], new WeakSet());
	}
	return Array.from(menu.querySelectorAll("button")).map((b) => b.textContent ?? "");
}

function menuChannel(hasPermission: () => boolean): InstanceType<typeof Channel> {
	return Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		type: 0,
		owner_id: "owner-1",
		// headchannels backs the Move-to row's "guild has categories" read (channel.ts:297).
		owner: {localuser: {user: {id: "me-1"}}, headchannels: []},
		hasPermission,
	}) as InstanceType<typeof Channel>;
}

it("hides channel settings from a member without MANAGE_CHANNELS", () => {
	const labels = menuLabels(menuChannel(() => false));
	// Positive control: the menu itself built, so an empty render can't pass the row pin.
	expect(labels).toContain(I18n.channel.markRead());
	expect(labels).not.toContain(I18n.channel.settings());
});

it("still offers channel settings to a member with MANAGE_CHANNELS", () => {
	const labels = menuLabels(menuChannel(() => true));
	expect(labels).toContain(I18n.channel.settings());
});
