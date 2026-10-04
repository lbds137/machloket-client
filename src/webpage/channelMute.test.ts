import {describe, expect, it} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");

const API = "http://mute.test/api/v9";

describe("unmuting a channel", () => {
	it("keeps the channel's notification level, not its unread-mention count", async () => {
		const sent = captureRequests(API + "/users/@me/guilds/g1/settings", () => Response.json({}));
		const channel = Object.assign(Object.create(Channel.prototype), {
			id: "c1",
			// `guild` is the owner.
			owner: {id: "g1", info: {api: API}, unreads: () => {}},
			headers: {},
			mentions: 5,
			message_notifications: 1,
			unreads: () => {},
		}) as InstanceType<typeof Channel>;

		channel.unmuteChannel();

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({channel_overrides: {c1: {message_notifications: 1, muted: false}}});
	});
});
