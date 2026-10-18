import {expect, it} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Message} = await import("./message");
const {MarkDown} = await import("./markdown");

const API = "http://edit.test/api/v9";

/** Message m1 in channel c1, its text as typed being `raw`. */
function messageSaying(raw: string) {
	return Object.assign(Object.create(Message.prototype), {
		id: "m1",
		owner: {id: "c1", info: {api: API}, localuser: {}},
		headers: {},
		content: new MarkDown(raw, undefined),
	}) as InstanceType<typeof Message>;
}

it("an edit that only takes the formatting out is sent", async () => {
	const sent = captureRequests(API + "/channels/c1/messages/m1", () => Response.json({}));
	const message = messageSaying("**important**");

	await message.edit("important");

	expect(sent).toEqual([{content: "important"}]);
});

// The old code compared the rendered text, so this was sent.
it("an edit that changes nothing isn't sent", async () => {
	const sent = captureRequests(API + "/channels/c1/messages/m2", () => Response.json({}));
	const message = Object.assign(messageSaying("**important**"), {id: "m2"});

	await message.edit("**important**");

	expect(sent).toEqual([]);
});
