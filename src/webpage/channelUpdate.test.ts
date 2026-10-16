import {expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");

/** A channel with only what updateChannel reads: the previous position is set, as after a
 * READY payload. */
function updatableChannel() {
	return Object.assign(Object.create(Channel.prototype), {
		position: 3,
		permission_overwrites: new Map(),
		permission_overwritesar: [],
		nameSpan: {deref: () => undefined},
		// `localuser` and `guild` are getters on the prototype: they read through the owner.
		owner: {localuser: {channelids: new Map()}, guild: {roleids: new Map()}},
		renderIcon: () => {},
		slowmode: () => {},
		fireEvents: () => {},
	}) as InstanceType<typeof Channel>;
}

it("a CHANNEL_UPDATE's position moves the channel", () => {
	const channel = updatableChannel();

	channel.updateChannel({type: 0, name: "general", position: 9} as never);

	expect(channel.position).toBe(9);
});
