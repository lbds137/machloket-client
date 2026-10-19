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

describe("an edit back to the text the server last echoed", () => {
	const path = (id: string) => API + "/channels/c1/messages/" + id;

	it("is sent after a saved edit the server hasn't echoed yet", async () => {
		const sent = captureRequests(path("r1"), () => Response.json({}));
		const message = Object.assign(messageSaying("original"), {id: "r1"});

		await message.edit("changed");
		await message.edit("original");

		expect(sent).toEqual([{content: "changed"}, {content: "original"}]);
	});

	it("is sent while the edit before it is still on its way", async () => {
		let answer: (res: Response) => void = () => {};
		const answers = [
			new Promise<Response>((r) => (answer = r)),
			Promise.resolve(Response.json({})),
		];
		const sent = captureRequests(path("r2"), () => answers.shift()!);
		const message = Object.assign(messageSaying("original"), {id: "r2"});

		const first = message.edit("changed");
		const second = message.edit("original");
		answer(Response.json({}));
		await Promise.all([first, second]);

		expect(sent).toEqual([{content: "changed"}, {content: "original"}]);
	});

	const refusedEdit = () => Response.json({code: 50035, message: "Too long"}, {status: 400});

	it("an edit retried after a refusal is sent, even when it was asked for twice in flight", async () => {
		let answer: (res: Response) => void = () => {};
		const answers = [
			new Promise<Response>((r) => (answer = r)),
			Promise.resolve(Response.json({})),
		];
		const sent = captureRequests(path("r5"), () => answers.shift()!);
		const message = Object.assign(messageSaying("original"), {id: "r5"});

		const first = message.edit("changed");
		await message.edit("changed"); // Enter twice: nothing new to send
		answer(refusedEdit());
		await first;
		await message.edit("changed");

		expect(sent).toEqual([{content: "changed"}, {content: "changed"}]);
	});

	it("a newer edit refused while an older one is on its way leaves the older as the base", async () => {
		let answer: (res: Response) => void = () => {};
		const answers = [
			new Promise<Response>((r) => (answer = r)),
			Promise.resolve(refusedEdit()),
			Promise.resolve(Response.json({})),
		];
		const sent = captureRequests(path("r6"), () => answers.shift()!);
		const message = Object.assign(messageSaying("original"), {id: "r6"});

		const first = message.edit("changed");
		await message.edit("too long");
		await message.edit("original");
		answer(Response.json({}));
		await first;

		expect(sent).toEqual([{content: "changed"}, {content: "too long"}, {content: "original"}]);
	});

	it("isn't sent after a refused edit: the server still holds it", async () => {
		const sent = captureRequests(path("r3"), () =>
			Response.json({code: 50035, message: "Too long"}, {status: 400}),
		);
		const message = Object.assign(messageSaying("original"), {id: "r3"});

		await message.edit("changed");
		await message.edit("original");

		expect(sent).toEqual([{content: "changed"}]);
	});

	it("isn't sent once the server's echo of the saved edit has come back and been reverted elsewhere", async () => {
		const sent = captureRequests(path("r4"), () => Response.json({}));
		const message = Object.assign(messageSaying("original"), {id: "r4"});
		Object.assign(message.owner, {
			infinite: {snapBottom: () => () => {}},
			guild: {id: "@me", roleids: new Map()},
		});

		await message.edit("changed");
		// Another device puts the text back; its echo is the newest thing the server holds.
		message.giveData({content: "original", author: {}} as never);
		await message.edit("original");

		expect(sent).toEqual([{content: "changed"}]);
	});

	it("an older edit's late answer doesn't replace a newer edit's echoed text as the base", async () => {
		let answer: (res: Response) => void = () => {};
		const answers = [
			new Promise<Response>((r) => (answer = r)),
			Promise.resolve(Response.json({})),
			Promise.resolve(Response.json({})),
		];
		const sent = captureRequests(path("r7"), () => answers.shift()!);
		const message = Object.assign(messageSaying("original"), {id: "r7"});
		Object.assign(message.owner, {
			infinite: {snapBottom: () => () => {}},
			guild: {id: "@me", roleids: new Map()},
		});

		const first = message.edit("older");
		await message.edit("newer");
		message.giveData({content: "newer", author: {}} as never);
		answer(Response.json({}));
		await first;
		await message.edit("older");

		expect(sent).toEqual([{content: "older"}, {content: "newer"}, {content: "older"}]);
	});
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
