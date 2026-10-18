import {expect, it} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");

const API = "http://live.test/api/v9";

/** Channel c1 whose newest message (100, known from READY) was followed by a live message 200
 * while its first history page was still being fetched: MESSAGE_CREATE linked 100 → 200. */
function channelWithLiveMessage(liveId = "200") {
	const live = {id: liveId};
	return Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		owner: {id: "@me", info: {api: API}, unreads: () => {}, localuser: {}},
		headers: {},
		messages: new Map([[liveId, live]]),
		idToPrev: new Map([[liveId, "100"]]),
		idToNext: new Map([["100", liveId]]),
		lastmessage: live,
		lastmessageid: liveId,
		slowmode: async () => {},
		infinite: {snapBottom: () => () => {}},
	}) as InstanceType<typeof Channel>;
}

it("a first history page that lands after a live message doesn't rewind the channel's newest", async () => {
	// The page was produced before 200 existed: its newest is 100.
	captureRequests(API + "/channels/c1/messages", () =>
		Response.json([
			{id: "100", author: {}},
			{id: "99", author: {}},
		]),
	);
	const channel = channelWithLiveMessage();

	await channel.putmessages();

	expect(channel.lastmessageid).toBe("200");
	expect(channel.lastmessage?.id).toBe("200");
	expect(channel.idToNext.get("100")).toBe("200");
	expect(channel.idToNext.get("99")).toBe("100");
});

it("a pending send stays the channel's newest when the page lands", async () => {
	captureRequests(API + "/channels/c1/messages", () => Response.json([{id: "100", author: {}}]));
	const channel = channelWithLiveMessage("fake-1");

	await channel.putmessages();

	expect(channel.lastmessageid).toBe("fake-1");
});

it("an empty first page doesn't forget a live message that came meanwhile", async () => {
	captureRequests(API + "/channels/c1/messages", () => Response.json([]));
	const channel = channelWithLiveMessage();

	await channel.putmessages();

	expect(channel.lastmessageid).toBe("200");
});
