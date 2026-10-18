import {afterEach, describe, expect, it, vi} from "vitest";
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

describe("saving from the editor", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		document.body.replaceChildren();
	});

	it("a refused edit reopens the editor with what was typed, and says why", async () => {
		captureRequests(API + "/channels/c1/messages/m3", () =>
			Response.json({code: 50035, message: "Must be 2000 or fewer in length."}, {status: 400}),
		);
		const reopen = vi.spyOn(Message.prototype, "setEdit").mockImplementation(() => {});
		const message = Object.assign(messageSaying("old"), {id: "m3"});

		await message.saveEdit("new text");

		expect(reopen).toHaveBeenCalledOnce();
		expect(message.editDraft).toBe("new text");
		expect(document.body.textContent).toContain("Must be 2000 or fewer in length.");
	});

	it("an edit that never reached the server reopens the editor too", async () => {
		captureRequests(API + "/channels/c1/messages/m4", () =>
			Promise.reject(new TypeError("Failed to fetch")),
		);
		const reopen = vi.spyOn(Message.prototype, "setEdit").mockImplementation(() => {});
		const message = Object.assign(messageSaying("old"), {id: "m4"});

		await message.saveEdit("new text");

		expect(reopen).toHaveBeenCalledOnce();
		expect(message.editDraft).toBe("new text");
	});

	// A pin, not red-first: a saved edit closes the editor, as before.
	it("a saved edit doesn't reopen it", async () => {
		captureRequests(API + "/channels/c1/messages/m5", () => Response.json({}));
		const reopen = vi.spyOn(Message.prototype, "setEdit").mockImplementation(() => {});
		const message = Object.assign(messageSaying("old"), {id: "m5"});

		await message.saveEdit("new text");

		expect(reopen).not.toHaveBeenCalled();
	});

	const refused = () =>
		Response.json({code: 50035, message: "Must be 2000 or fewer in length."}, {status: 400});

	it("a refusal leaves alone an editor the user has opened on the message again", async () => {
		captureRequests(API + "/channels/c1/messages/m6", refused);
		const reopen = vi.spyOn(Message.prototype, "setEdit").mockImplementation(() => {});
		const message = Object.assign(messageSaying("old"), {id: "m6"});
		const saving = message.saveEdit("new text");
		Object.assign(message.channel, {editing: message});

		await saving;

		expect(reopen).not.toHaveBeenCalled();
		expect(message.editDraft).toBeUndefined();
		expect(document.body.textContent).toContain("Must be 2000 or fewer in length.");
	});

	it("a refusal doesn't take over another message's open editor", async () => {
		captureRequests(API + "/channels/c1/messages/m7", refused);
		const reopen = vi.spyOn(Message.prototype, "setEdit").mockImplementation(() => {});
		const message = Object.assign(messageSaying("old"), {id: "m7"});
		const saving = message.saveEdit("new text");
		Object.assign(message.channel, {editing: messageSaying("other")});

		await saving;

		expect(reopen).not.toHaveBeenCalled();
		expect(message.editDraft).toBeUndefined();
	});

	it("an edit saved after a refused one wins: the refusal neither reopens nor shows", async () => {
		let answer: (res: Response) => void = () => {};
		const answers = [
			new Promise<Response>((r) => (answer = r)),
			Promise.resolve(Response.json({})),
		];
		captureRequests(API + "/channels/c1/messages/m8", () => answers.shift()!);
		const reopen = vi.spyOn(Message.prototype, "setEdit").mockImplementation(() => {});
		const message = Object.assign(messageSaying("old"), {id: "m8"});

		const first = message.saveEdit("first");
		await message.saveEdit("second");
		answer(refused());
		await first;

		expect(reopen).not.toHaveBeenCalled();
		expect(document.body.textContent).not.toContain("Must be 2000");
	});
});
