import {afterEach, beforeEach, expect, it, vi} from "vitest";

// An account signed in for this session only (the store refused it) lives in the session
// overlay. The app's own full navigations hand it to the next page; a reload drops it.
// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("../localuser.js");
const {I18n} = await import("../i18n.js");
const {adduser} = await import("./utils.js");
const {AccountSwitcher} = await import("./switcher.js");
const {pageNav} = await import("./netUtils.js");
const {ACCOUNT_HANDOFF_KEY, isAccountStored, readItem, resetSettingOverlayForTests} =
	await import("./storage/settingOverlay.js");
await I18n.done;

const quota = () => new DOMException("The quota has been exceeded.", "QuotaExceededError");

function account(email: string) {
	const base = "http://session-nav.test";
	return {
		serverurls: {
			api: base + "/api/v9",
			cdn: base,
			gateway: "ws://session-nav.test",
			wellknown: base,
		},
		email,
		token: "fixture-token",
	};
}

function stubFullLocalStorage() {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const realSetItem = Storage.prototype.setItem;
	return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
		this: Storage,
		key: string,
		value: string,
	) {
		if (this === localStorage) throw quota();
		return realSetItem.call(this, key, value);
	});
}

const initialUserinfos = localStorage.getItem("userinfos");
function reset() {
	vi.restoreAllMocks();
	if (initialUserinfos !== null) localStorage.setItem("userinfos", initialUserinfos);
	else localStorage.removeItem("userinfos");
	sessionStorage.removeItem(ACCOUNT_HANDOFF_KEY);
	sessionStorage.removeItem("currentuser");
	resetSettingOverlayForTests();
	document.querySelectorAll(".accountSwitcher, .background").forEach((el) => el.remove());
}
beforeEach(reset);
afterEach(reset);

it("add-account from a session-only account keeps it", () => {
	stubFullLocalStorage();
	const u = adduser(account("session@session-nav.test"));
	expect(sessionStorage.getItem(ACCOUNT_HANDOFF_KEY)).toBeNull();
	const load = vi.spyOn(pageNav, "load").mockImplementation(() => {});

	void new AccountSwitcher().show();
	const add = [...document.querySelectorAll<HTMLElement>(".accountSwitcher .switchtable")].find(
		(el) => el.textContent === I18n.addAccount(),
	);
	add!.click();

	expect(load).toHaveBeenCalledWith("/login");
	// The login page boots from this hand-off; without it the account is gone.
	const handoff = sessionStorage.getItem(ACCOUNT_HANDOFF_KEY);
	expect(handoff).toBe(readItem("userinfos"));
	expect(JSON.parse(handoff!).users[u.uid]).toBeDefined();
});

it("a navigation with no session-only account writes no hand-off", () => {
	const load = vi.spyOn(pageNav, "load").mockImplementation(() => {});
	pageNav.go("/login");
	expect(load).toHaveBeenCalledWith("/login");
	expect(sessionStorage.getItem(ACCOUNT_HANDOFF_KEY)).toBeNull();
});

it("an account is stored only when the browser's store itself holds it", () => {
	const u = adduser(account("stored@session-nav.test"));
	expect(isAccountStored(u.uid)).toBe(true);

	stubFullLocalStorage();
	const s = adduser(account("overlay@session-nav.test"));
	// Readable for this session (the overlay), but a reload loses it.
	expect(JSON.parse(readItem("userinfos")!).users[s.uid]).toBeDefined();
	expect(isAccountStored(s.uid)).toBe(false);
});

it("an unreadable store holds no account", () => {
	localStorage.setItem("userinfos", "{not json");
	expect(isAccountStored("anyone")).toBe(false);
});
