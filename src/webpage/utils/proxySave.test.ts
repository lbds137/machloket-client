import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("../localuser");
const {Specialuser} = await import("./utils.js");

const quota = () => new DOMException("The quota has been exceeded.", "QuotaExceededError");

function makeUser() {
	return new Specialuser({
		serverurls: {
			api: "https://proxy-save.test/api",
			cdn: "https://proxy-save.test/cdn",
			gateway: "wss://proxy-save.test/gateway",
			wellknown: "https://proxy-save.test",
		},
		email: "proxy-save@example.test",
		token: "fixture-token",
	});
}

function storedUser(uid: string) {
	return JSON.parse(localStorage.getItem("userinfos")!).users[uid];
}

const {resetSettingOverlayForTests} = await import("./storage/settingOverlay.js");

// Each test leaves the accounts as it found them: in the store (removed if there were none)
// and in the session overlay a refused write fills.
const stored = localStorage.getItem("userinfos");
afterEach(() => {
	vi.restoreAllMocks();
	if (stored !== null) localStorage.setItem("userinfos", stored);
	else localStorage.removeItem("userinfos");
	resetSettingOverlayForTests();
});

it("drops a value too big to store, so the account's later saves still land", () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const user = makeUser();
	const store = user.localuserStore;
	store.kept = {note: "small"};
	const realSetItem = Storage.prototype.setItem;
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
		if (this === localStorage && value.includes("OVERSIZED")) throw quota();
		return realSetItem.call(this, key, value);
	});

	const oversized = "OVERSIZED".padEnd(20_000, "x");
	store.kept = {note: oversized};

	// The previous value comes back instead of the one that can't fit...
	expect(user.localuserStore.kept).toEqual({note: "small"});
	// ...so it no longer rides along in every save of this account.
	user.username = "after";
	expect(storedUser(user.uid).username).toBe("after");
});

it("keeps a small value for this session when the store is at its edge", () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const user = makeUser();
	user.localuserStore.guilds ??= {};
	// Nearly full: the account as it stands still saves, but nothing may grow it.
	const fits = localStorage.getItem("userinfos")!.length;
	const realSetItem = Storage.prototype.setItem;
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
		if (this === localStorage && value.length > fits) throw quota();
		return realSetItem.call(this, key, value);
	});

	// A guild's first `perminfo ??= {channels: {}}`: dropping it would hand the guild's next
	// read an undefined, the boot failure this guards against.
	user.localuserStore.guilds["700"] ??= {channels: {}};
	expect(user.localuserStore.guilds["700"]).toEqual({channels: {}});
});

it("doesn't throw out of the save when a value can't be serialised at all", () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const user = makeUser();
	// JSON.stringify throws on a BigInt: the account's save fails, and sizing the value
	// mustn't throw a second time from inside the set trap.
	expect(() => {
		user.localuserStore.odd = 1n as never;
	}).not.toThrow();
});

it("keeps a value for this session when the store refuses every write", () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const user = makeUser();
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw quota();
	});

	// A full store: nothing fits, so a rollback would only hand the next read an undefined.
	user.localuserStore.guilds ??= {};
	expect(user.localuserStore.guilds).toEqual({});
});

it("a large value kept on a full store is in the session's accounts too, not only in memory", async () => {
	const {readItem} = await import("./storage/settingOverlay.js");
	vi.spyOn(console, "error").mockImplementation(() => {});
	const user = makeUser();
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw quota();
	});
	const large = "LARGE".padEnd(20_000, "x");
	user.localuserStore.kept = {note: large};
	expect(user.localuserStore.kept).toEqual({note: large});
	// The session's accounts (what a navigation hands on, and what other readers see) must
	// hold what memory holds, not the copy from before the value was put back.
	const session = JSON.parse(readItem("userinfos")!);
	expect(session.users[user.uid].localuserStore.kept).toEqual({note: large});
});
