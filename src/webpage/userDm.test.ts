import {afterEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {User} = await import("./user");
const {Channel} = await import("./channel");
const {I18n} = await import("./i18n");
await I18n.done;

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll("dialog, .PopUp").forEach((e) => e.remove());
});

function userWithNoDm(goToChannel: (id: string) => Promise<void>, channelids = new Map()) {
	return Object.assign(Object.create(User.prototype), {
		id: "u2",
		owner: {
			info: {api: "http://dm.test/api/v9"},
			headers: {},
			guildids: new Map([["@me", {channels: []}]]),
			channelids,
			goToChannel,
		},
	}) as InstanceType<typeof User>;
}

it("a refused DM says so instead of waiting forever for a channel that doesn't exist", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({message: "Cannot send messages to this user", code: 50007}, {status: 403}),
	);
	const goTo = vi.fn(async () => {});
	const user = userWithNoDm(goTo);

	await user.opendm("hi");

	expect(goTo).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 403"));
});

it("an unreachable instance says so too", async () => {
	vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
	const goTo = vi.fn(async () => {});

	await userWithNoDm(goTo).opendm();

	expect(goTo).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain(I18n.requestFailed("offline"));
});

it("the typed message goes to the DM the server created, found by its id", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({id: "dm9", type: 1}));
	const sendMessage = vi.fn();
	const channelids = new Map();
	// Only in channelids: the lookup is by the created id, not a recipient scan of @me.
	const goTo = vi.fn(async (id: string) => {
		channelids.set(id, {id, type: 1, users: [{id: "u2"}], sendMessage});
	});

	await userWithNoDm(goTo, channelids).opendm("hi");

	expect(sendMessage).toHaveBeenCalledWith(
		"hi",
		expect.objectContaining({replyingto: null}),
		expect.any(Function),
	);
});

describe("a popout's message that's refused", () => {
	afterEach(() => {
		document.getElementById("typebox")?.remove();
		document.getElementById("pasteimage")?.remove();
		vi.unstubAllGlobals();
	});

	/** Counts what reaches the server: text that wasn't put back goes there for a failed bubble.
	 * Send answers 200 so the driven chain, which these tests await, settles. */
	function countSends() {
		const send = vi.fn();
		vi.stubGlobal(
			"XMLHttpRequest",
			class {
				upload = {};
				status = 200;
				onload: (() => void) | null = null;
				open() {}
				setRequestHeader() {}
				send(...args: unknown[]) {
					send(...args);
					this.onload?.();
				}
			},
		);
		return send;
	}

	/**
	 * A user with an open DM on an instance limiting messages to 5, its composer holding `typed`.
	 * With `gated`, goToChannel blocks until `release` resolves it.
	 */
	function openDm(typed = "", gated = false) {
		const {promise: gate, resolve: release} = Promise.withResolvers<void>();
		const typebox = Object.assign(document.createElement("div"), {
			id: "typebox",
			textContent: typed,
			markdown: {txt: typed, boxupdate: vi.fn()},
		});
		const pasted = Object.assign(document.createElement("div"), {id: "pasteimage"});
		document.body.append(typebox, pasted);
		const dm = Object.assign(Object.create(Channel.prototype), {
			id: "dm1",
			type: 1,
			users: [{id: "u2"}],
			files: [] as Blob[],
			textSave: "",
			owner: {info: {api: "http://dm.test/api/v9"}},
			headers: {},
			setStoredDraft: vi.fn(),
			makeFakeMessage: vi.fn(async () => ({progress() {}, failed() {}, void() {}})),
		}) as InstanceType<typeof Channel>;
		Object.defineProperty(dm, "localuser", {
			value: {channelfocus: dm, messageLimit: 5},
			configurable: true,
		});
		const user = userWithNoDm(
			vi.fn(async () => {
				if (gated) await gate;
			}),
		);
		user.localuser.guildids.get("@me")!.channels.push(dm as never);
		return {user, typebox, pasted, dm, release};
	}

	it("comes back in the DM's composer: the popout it was typed in has closed", async () => {
		const {user, typebox, dm} = openDm();

		await user.opendm("x".repeat(6));

		expect(typebox.textContent).toBe("x".repeat(6));
		expect(typebox.markdown.txt).toBe("x".repeat(6));
		expect(dm.textSave).toBe("x".repeat(6));
	});

	it("leaves what's already in that composer alone", async () => {
		const {user, typebox, release} = openDm("mine", true);
		const send = countSends();

		const running = user.opendm("x".repeat(6));
		release();
		await running;

		// Not put back, so it goes the way that keeps it: to the server, for a failed bubble.
		expect(send).toHaveBeenCalledOnce();
		expect(typebox.textContent).toBe("mine");
	});

	it("doesn't join a file waiting in that composer, which would send with it", async () => {
		const {user, typebox, pasted, release} = openDm("", true);
		pasted.append(document.createElement("img"));
		const send = countSends();

		const running = user.opendm("x".repeat(6));
		release();
		await running;

		expect(send).toHaveBeenCalledOnce();
		expect(typebox.textContent).toBe("");
	});

	describe("with another channel open", () => {
		function openElsewhere(gated = false) {
			const opened = openDm("", gated);
			Object.defineProperty(opened.dm, "localuser", {
				value: {channelfocus: {id: "other"}, messageLimit: 5},
			});
			return opened;
		}

		it("becomes the DM's draft, leaving the open composer alone", async () => {
			const {user, typebox, dm} = openElsewhere();
			const send = countSends();

			await user.opendm("x".repeat(6));

			expect(dm.textSave).toBe("x".repeat(6));
			expect(typebox.textContent).toBe("");
			expect(send).not.toHaveBeenCalled();
		});

		it("doesn't overwrite the DM's draft", async () => {
			const {user, dm, release} = openElsewhere(true);
			dm.textSave = "mine";
			const send = countSends();

			const running = user.opendm("x".repeat(6));
			release();
			await running;

			expect(send).toHaveBeenCalledOnce();
			expect(dm.textSave).toBe("mine");
		});

		it("doesn't join files saved with the DM, which would send with it", async () => {
			const {user, dm, release} = openElsewhere(true);
			dm.files = [new Blob(["x"])];
			const send = countSends();

			const running = user.opendm("x".repeat(6));
			release();
			await running;

			expect(send).toHaveBeenCalledOnce();
			expect(dm.textSave).toBe("");
		});
	});
});

// A regression pin for the success path (passes before the fix too).
it("a new DM opens, then gets the typed message", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({id: "dm9", type: 1}));
	const sendMessage = vi.fn();
	const channelids = new Map();
	// goToChannel resolves once CHANNEL_CREATE has added the DM to @me and channelids.
	const goTo = vi.fn(async (id: string) => {
		const dm = {id, type: 1, users: [{id: "u2"}], sendMessage};
		channelids.set(id, dm);
		user.localuser.guildids.get("@me")!.channels.push(dm as never);
	});
	const user = userWithNoDm(goTo, channelids);

	await user.opendm("hi");

	expect(goTo).toHaveBeenCalledWith("dm9");
	expect(sendMessage).toHaveBeenCalledWith(
		"hi",
		expect.objectContaining({replyingto: null}),
		expect.any(Function),
	);
});
