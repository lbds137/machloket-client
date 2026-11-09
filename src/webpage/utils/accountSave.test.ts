import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("../localuser");
const {Specialuser} = await import("./utils.js");

const quota = () => new DOMException("The quota has been exceeded.", "QuotaExceededError");

function makeUser() {
	return new Specialuser({
		serverurls: {
			api: "https://account-save.test/api",
			cdn: "https://account-save.test/cdn",
			gateway: "wss://account-save.test/gateway",
			wellknown: "https://account-save.test",
		},
		email: "account-save@example.test",
		token: "old-token",
	});
}

function storedUser(uid: string) {
	return JSON.parse(localStorage.getItem("userinfos")!).users[uid];
}

const stored = localStorage.getItem("userinfos");
afterEach(() => {
	vi.restoreAllMocks();
	if (stored !== null) localStorage.setItem("userinfos", stored);
	else localStorage.removeItem("userinfos");
});

it("an account save with userinfos gone (another tab cleared site data) is logged, not thrown", () => {
	// READY's saves run after the account was read at boot; a cleared store mid-session is the
	// store's state, not a bug, and throwing it would stop READY.
	vi.spyOn(console, "error").mockImplementation(() => {});
	const user = makeUser();
	localStorage.removeItem("userinfos");
	let saved: boolean | undefined;
	expect(() => (saved = user.tryUpdateLocal())).not.toThrow();
	expect(saved).toBe(false);
});

it("a refreshed token still saves when the store can't take the whole account", () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const user = makeUser();
	user.localuserStore.guilds ??= {};
	const storedStore = storedUser(user.uid).localuserStore;
	// Nearly full: the account as stored fits, but nothing may grow it...
	const fits = localStorage.getItem("userinfos")!.length;
	const realSetItem = Storage.prototype.setItem;
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
		if (this === localStorage && value.length > fits) throw quota();
		return realSetItem.call(this, key, value);
	});
	// ...and a guild's first perminfo, kept in memory for the session, rides in every later save.
	user.localuserStore.guilds["700"] ??= {channels: {}};

	// READY's auth_token refresh: the token is the same length, so on its own it fits.
	user.json.token = "new-token";
	user.tryUpdateLocal();

	expect(storedUser(user.uid).token).toBe("new-token");
	// The store as last saved stays: this save never writes in-memory store growth (or
	// clobbers a newer store another tab saved).
	expect(storedUser(user.uid).localuserStore).toEqual(storedStore);
});

it("an error that isn't the store's refusal comes out of an account save", () => {
	const user = makeUser();
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw new TypeError("not the store");
	});
	expect(() => user.tryUpdateLocal()).toThrow(TypeError);
});

// A large value's save is refused, then the saves that follow it (the account without the
// store's growth, then the account without the value) each get their turn to hit a bug.
it.each([1, 2])(
	"an error that isn't the store's refusal comes out after %i refused saves",
	(refusals) => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const user = makeUser();
		user.tryUpdateLocal();
		const store = user.localuserStore;
		let calls = 0;
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			if (++calls <= refusals) throw quota();
			throw new TypeError("not the store");
		});
		expect(() => {
			store.big = {note: "x".repeat(20_000)};
		}).toThrow(TypeError);
	},
);
