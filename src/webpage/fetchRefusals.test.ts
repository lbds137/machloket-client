import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Message} = await import("./message");
const {Dialog} = await import("./settings");
const {RoleList} = await import("./role");

const API = "http://refusal.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll("dialog, .PopUp").forEach((e) => e.remove());
});

/** A Message with only the fields read by reactionToggle, setPinned, and delete. */
function fakeMessage() {
	return Object.assign(Object.create(Message.prototype), {
		id: "m1",
		headers: {},
		reactions: [],
		owner: {
			id: "c1",
			info: {api: API},
			localuser: {favorites: {addReactEmoji: () => {}}},
		},
	}) as InstanceType<typeof Message>;
}

it("a refused reaction shows the dialog; a 204 reaction does not", async () => {
	const url = `${API}/channels/c1/messages/m1/reactions/${encodeURIComponent("👍")}/@me`;
	const shown = vi.spyOn(Dialog.prototype, "show");
	const msg = fakeMessage();

	captureRequests(url, () => new Response(null, {status: 204}));
	await msg.reactionToggle("👍");
	expect(shown).not.toHaveBeenCalled();

	captureRequests(url, () => new Response(null, {status: 403}));
	await msg.reactionToggle("👍");
	expect(shown).toHaveBeenCalledOnce();
});

it("an offline reaction shows the dialog and isn't saved as a recent emoji", async () => {
	const url = `${API}/channels/c1/messages/m1/reactions/${encodeURIComponent("👍")}/@me`;
	captureRequests(url, () => Promise.reject(new TypeError("offline")));
	const shown = vi.spyOn(Dialog.prototype, "show");
	const msg = fakeMessage();
	const addReactEmoji = vi.spyOn(msg.localuser.favorites, "addReactEmoji");

	await msg.reactionToggle("👍");

	expect(shown).toHaveBeenCalledOnce();
	expect(addReactEmoji).not.toHaveBeenCalled();
});

it("clicking a reaction again while its request is in flight sends nothing more", async () => {
	const url = `${API}/channels/c1/messages/m1/reactions/${encodeURIComponent("👍")}/@me`;
	const answers: ((res: Response) => void)[] = [];
	const sent = captureRequests(url, () => new Promise<Response>((r) => answers.push(r)));
	const msg = fakeMessage();

	const first = msg.reactionToggle("👍");
	const second = msg.reactionToggle("👍");
	await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
	await new Promise((r) => setTimeout(r, 50));
	for (const answer of answers) answer(new Response(null, {status: 204}));
	await Promise.all([first, second]);

	expect(sent).toHaveLength(1);
});

it("a refused or offline message delete shows the dialog", async () => {
	const url = `${API}/channels/c1/messages/m1`;
	const shown = vi.spyOn(Dialog.prototype, "show");
	const msg = fakeMessage();

	captureRequests(url, () => new Response(null, {status: 403}));
	await msg.delete();
	expect(shown).toHaveBeenCalledTimes(1);

	captureRequests(url, () => Promise.reject(new TypeError("offline")));
	await msg.delete();
	expect(shown).toHaveBeenCalledTimes(2);
});

it("a pin whose request rejects shows the alert and does not throw", async () => {
	captureRequests(`${API}/channels/c1/pins/m1`, () => Promise.reject(new TypeError("offline")));
	const alerted = vi.spyOn(window, "alert").mockImplementation(() => {});
	const msg = fakeMessage();

	await expect(msg.setPinned(true)).resolves.toBeUndefined();

	expect(alerted).toHaveBeenCalledOnce();
});

it("a refused channel overwrite removal shows the dialog", async () => {
	captureRequests(`${API}/channels/c1/permissions/r1`, () => new Response(null, {status: 403}));
	const shown = vi.spyOn(Dialog.prototype, "show");
	const list = Object.assign(Object.create(RoleList.prototype), {
		channel: {id: "c1"},
		guild: {info: {api: API}, headers: {}},
	}) as InstanceType<typeof RoleList>;

	await list.removeOverwrite("r1");

	expect(shown).toHaveBeenCalledOnce();
});
