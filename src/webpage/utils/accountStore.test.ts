import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {addInstance, captureRequests} from "../test/setup.js";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("../localuser.js");
const {Dialog} = await import("../settings.js");
const {adduser, bootAccountId, getBulkUsers, getDefaultInstanceUrl, instancefetch, Specialuser} =
	await import("./utils.js");
const {
	ACCOUNT_HANDOFF_KEY,
	carryAccountsAcrossNavigation,
	consumeAccountHandoff,
	loadAccountHandoff,
	readItem,
	resetSettingOverlayForTests,
	saveAccounts,
	saveSetting,
	writeAccounts,
} = await import("./storage/settingOverlay.js");
const {recoveryInstance} = await import("../recover.js");

const HANDOFF_KEY = ACCOUNT_HANDOFF_KEY;

const ACCOUNT_NOT_SAVED_COPY =
	"Signed in for this session only: this browser's storage for Machloket is full, so you'll need to sign in again after a reload.";
const SETTING_NOT_SAVED_COPY =
	"Couldn't save this setting: this browser's storage for Machloket is full. It applies until you reload.";

const quota = () => new DOMException("The quota has been exceeded.", "QuotaExceededError");

function account(email: string) {
	const base = "http://acct.test";
	return {
		serverurls: {
			api: base + "/api/v9",
			cdn: base,
			gateway: "ws://acct.test",
			wellknown: base,
		},
		email,
		token: "fake-token-" + email,
		loggedin: true,
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

function dialogTexts(): string[] {
	return [...document.querySelectorAll(".background:not(.removeElm) .dialogModal")].map(
		(el) => el.textContent ?? "",
	);
}

async function flushAsyncDialog() {
	await new Promise((r) => setTimeout(r, 30));
}

const initialUserinfos = localStorage.getItem("userinfos");

beforeEach(() => {
	if (initialUserinfos !== null) localStorage.setItem("userinfos", initialUserinfos);
	else localStorage.removeItem("userinfos");
	localStorage.removeItem("userinfos.unreadable");
	localStorage.removeItem("instanceinfo");
	sessionStorage.removeItem(HANDOFF_KEY);
	sessionStorage.removeItem("currentuser");
	resetSettingOverlayForTests();
	document.querySelectorAll(".background").forEach((el) => el.remove());
});

afterEach(() => {
	vi.restoreAllMocks();
	if (initialUserinfos !== null) localStorage.setItem("userinfos", initialUserinfos);
	else localStorage.removeItem("userinfos");
	localStorage.removeItem("userinfos.unreadable");
	localStorage.removeItem("instanceinfo");
	sessionStorage.removeItem(HANDOFF_KEY);
	sessionStorage.removeItem("currentuser");
	resetSettingOverlayForTests();
	document.querySelectorAll(".background").forEach((el) => el.remove());
});

it.each(["{", "42", "{}"])(
	"getBulkUsers() with userinfos %j doesn't throw and returns empty users",
	(corrupt) => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		localStorage.setItem("userinfos", corrupt);

		let result: {users?: Record<string, unknown>} | undefined;
		expect(() => {
			result = getBulkUsers();
		}).not.toThrow();
		expect(result?.users).toEqual({});
		expect(warn).toHaveBeenCalledWith("userinfos store is unreadable, reading as signed out");
	},
);

it("a refused adduser keeps the account in the session overlay and shows one Dialog", async () => {
	stubFullLocalStorage();

	let u: InstanceType<typeof Specialuser> | undefined;
	expect(() => {
		u = adduser(account("a@example.test"));
	}).not.toThrow();
	expect(getBulkUsers().users[u!.uid]).toBeDefined();
	expect(sessionStorage.getItem("currentuser")).toBe(u!.uid);

	await vi.waitFor(() => {
		expect(dialogTexts()).toEqual([ACCOUNT_NOT_SAVED_COPY]);
	});

	expect(() => adduser(account("b@example.test"))).not.toThrow();
	await flushAsyncDialog();
	expect(dialogTexts()).toEqual([ACCOUNT_NOT_SAVED_COPY]);
});

it("account and setting dialogs are independent in the same session", async () => {
	stubFullLocalStorage();

	expect(() => adduser(account("a@example.test"))).not.toThrow();
	expect(() => saveSetting("userPreferences", "{}")).not.toThrow();

	await vi.waitFor(() => {
		expect(dialogTexts()).toEqual([ACCOUNT_NOT_SAVED_COPY, SETTING_NOT_SAVED_COPY]);
	});
});

it("carryAccountsAcrossNavigation writes the overlay to sessionStorage only when non-empty", () => {
	carryAccountsAcrossNavigation();
	expect(sessionStorage.getItem(HANDOFF_KEY)).toBeNull();

	stubFullLocalStorage();
	expect(() => adduser(account("a@example.test"))).not.toThrow();
	carryAccountsAcrossNavigation();

	expect(sessionStorage.getItem(HANDOFF_KEY)).toBe(readItem("userinfos"));
	expect(sessionStorage.getItem(HANDOFF_KEY)).not.toBeNull();
});

it("handoff lifecycle loads the account at module load and consumes it with one Dialog", async () => {
	const u = new Specialuser(account("handoff@example.test"));
	const payload = JSON.stringify({
		currentuser: u.uid,
		users: {[u.uid]: u.toJSON()},
		preferences: {notifications: false, notisound: "three"},
	});
	sessionStorage.setItem(HANDOFF_KEY, payload);

	loadAccountHandoff();
	expect(getBulkUsers().users[u.uid]).toBeDefined();

	consumeAccountHandoff();
	expect(sessionStorage.getItem(HANDOFF_KEY)).toBeNull();
	await vi.waitFor(() => {
		expect(dialogTexts()).toEqual([ACCOUNT_NOT_SAVED_COPY]);
	});

	consumeAccountHandoff();
	await flushAsyncDialog();
	expect(dialogTexts()).toEqual([ACCOUNT_NOT_SAVED_COPY]);
});

it("writeAccounts updates a pending handoff on refusal and removes it when a write lands", () => {
	const initial = JSON.stringify({currentuser: null, users: {}});
	sessionStorage.setItem(HANDOFF_KEY, initial);
	loadAccountHandoff();

	const setItemSpy = stubFullLocalStorage();
	const refusedValue = JSON.stringify({currentuser: "u1", users: {}});
	expect(() => writeAccounts(refusedValue)).toThrow(DOMException);
	expect(sessionStorage.getItem(HANDOFF_KEY)).toBe(refusedValue);
	expect(readItem("userinfos")).toBe(refusedValue);

	setItemSpy.mockRestore();
	const landedValue = JSON.stringify({currentuser: "u2", users: {}});
	expect(() => writeAccounts(landedValue)).not.toThrow();
	expect(sessionStorage.getItem(HANDOFF_KEY)).toBeNull();

	const direct = JSON.stringify({currentuser: "u3", users: {}});
	localStorage.setItem("userinfos", direct);
	expect(readItem("userinfos")).toBe(direct);
});

it("tryUpdateLocal on a refused store updates the overlay and pending handoff", () => {
	stubFullLocalStorage();

	let u!: InstanceType<typeof Specialuser>;
	expect(() => {
		u = adduser(account("session@example.test"));
	}).not.toThrow();
	carryAccountsAcrossNavigation();

	u.username = "SessionAlice";
	expect(getBulkUsers().users[u.uid].username).toBe("SessionAlice");
	expect(JSON.parse(readItem("userinfos")!).users[u.uid].username).toBe("SessionAlice");
	expect(JSON.parse(sessionStorage.getItem(HANDOFF_KEY)!).users[u.uid].username).toBe(
		"SessionAlice",
	);
});

it("quiet account writes do not throw or show a Dialog when refused", async () => {
	const u = adduser(account("quiet@example.test"));
	stubFullLocalStorage();

	expect(saveAccounts(JSON.stringify({currentuser: null, users: {}}))).toBe(false);
	expect(() => u.remove()).not.toThrow();

	captureRequests("http://ping-quiet.test/api/v9/ping", () =>
		Response.json({instance: {name: "QuietHome"}}),
	);
	const lu = Object.assign(Object.create(Localuser.prototype), {
		info: {api: "http://ping-quiet.test/api/v9", wellknown: "http://ping-quiet.test"},
		headers: {},
		instancePing: {name: "Unknown"},
	}) as InstanceType<typeof Localuser>;
	vi.spyOn(lu, "pageTitle").mockImplementation(() => {});

	await expect(lu.pingEndpoint()).resolves.toBeUndefined();
	expect(lu.instancePing.name).toBe("QuietHome");

	await flushAsyncDialog();
	expect(dialogTexts()).toEqual([]);
});

it("remove() and pingEndpoint on an unreadable store skip writing and keep the corrupt string", async () => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
	localStorage.setItem("userinfos", "{");

	const u = new Specialuser(account("remove@example.test"));
	sessionStorage.setItem("currentuser", u.uid);
	expect(() => u.remove()).not.toThrow();
	expect(sessionStorage.getItem("currentuser")).toBeNull();
	expect(localStorage.getItem("userinfos")).toBe("{");

	captureRequests("http://ping-corrupt.test/api/v9/ping", () =>
		Response.json({instance: {name: "CorruptHome"}}),
	);
	const lu = Object.assign(Object.create(Localuser.prototype), {
		info: {api: "http://ping-corrupt.test/api/v9", wellknown: "http://ping-corrupt.test"},
		headers: {},
		instancePing: {name: "Unknown"},
	}) as InstanceType<typeof Localuser>;
	vi.spyOn(lu, "pageTitle").mockImplementation(() => {});

	await expect(lu.pingEndpoint()).resolves.toBeUndefined();
	expect(lu.instancePing.name).toBe("CorruptHome");
	expect(localStorage.getItem("userinfos")).toBe("{");
});

it("adduser on an unreadable store keeps the raw value under userinfos.unreadable and starts fresh", () => {
	localStorage.setItem("userinfos", "{corrupt-accounts");

	let u!: InstanceType<typeof Specialuser>;
	expect(() => {
		u = adduser(account("fresh@example.test"));
	}).not.toThrow();

	expect(localStorage.getItem("userinfos.unreadable")).toBe("{corrupt-accounts");
	expect(Object.keys(getBulkUsers().users)).toEqual([u.uid]);
});

it("InstancePicker still calls onchange with the urls when the instanceinfo write is refused", async () => {
	addInstance("http://picked-full.test", 0);
	stubFullLocalStorage();

	const onchange = vi.fn();
	const picker = new Dialog("").options.addInstancePicker(onchange, {instance: ""});
	picker.input.value = "http://picked-full.test";
	await expect(picker.validate()).resolves.toBeUndefined();

	expect(onchange).toHaveBeenCalledTimes(1);
	expect(onchange.mock.calls[0][0].api).toBe("http://picked-full.test/api/v9");
});

it("recoveryInstance falls back to the default instance when instanceinfo is corrupt", async () => {
	await instancefetch;
	const defaultUrl = getDefaultInstanceUrl()!;
	addInstance(defaultUrl, 0);
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	localStorage.setItem("instanceinfo", "{corrupt");

	const resolved = await recoveryInstance();

	expect(resolved?.api).toBe(defaultUrl + "/api/v9");
	expect(warn).toHaveBeenCalled();
});

it("after a reload drops a session-only sign-in, boot picks the stored default account", () => {
	// The session-only account A is gone after the reload, but this tab still names it as its
	// pick; the stored default B must boot, not the login form.
	sessionStorage.setItem("currentuser", "a@example.testhttp://acct.test");
	const stored = {
		currentuser: "b@example.testhttp://acct.test",
		users: {"b@example.testhttp://acct.test": {}},
	};

	expect(bootAccountId(stored)).toBe("b@example.testhttp://acct.test");
});

it("boot keeps this tab's pick while that account exists", () => {
	sessionStorage.setItem("currentuser", "a@example.testhttp://acct.test");
	const stored = {
		currentuser: "b@example.testhttp://acct.test",
		users: {"a@example.testhttp://acct.test": {}, "b@example.testhttp://acct.test": {}},
	};

	expect(bootAccountId(stored)).toBe("a@example.testhttp://acct.test");
});
