import {afterEach, beforeEach, expect, it, onTestFinished, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("../../localuser");
const {getPreferences, ThemeOption, updatePreferences, UserPreferences} =
	await import("./userPreferences.js");
const {getSensitiveContentSync, setSensitiveContent} = await import("../sensitiveContent.js");
const {DeveloperSettings, getDeveloperSettings, setDeveloperSettings} =
	await import("./devSettings.js");
const {getLocalSettings, LocalSettings, ServiceWorkerMode, setLocalSettings} =
	await import("./localSettings.js");
const {BOT_HIDE_TAG, getBotConfigs, setBotConfigs} = await import("./botConfigs.js");
const {getSkinTone, setSkinTone} = await import("../skinTone.js");
const {MarkDown} = await import("../../markdown.js");
const {Channel} = await import("../../channel.js");
const {bumpCommandRecency} = await import("../../commandRecency.js");
const {showChangelogPopup} = await import("../../changelog.js");
const {readItem, resetSettingOverlayForTests, saveSetting} = await import("./settingOverlay.js");
const {Dialog} = await import("../../settings.js");
const {I18n} = await import("../../i18n.js");

const EXPECTED_COPY =
	"Couldn't save this setting: this browser's storage for Machloket is full. It applies until you reload.";

const quota = () => new DOMException("", "QuotaExceededError");

function stubFullStorage() {
	vi.spyOn(console, "error").mockImplementation(() => {});
	return vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw quota();
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

beforeEach(() => {
	localStorage.clear();
	resetSettingOverlayForTests();
	document.querySelectorAll(".background").forEach((el) => el.remove());
});

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.clear();
	resetSettingOverlayForTests();
	document.querySelectorAll(".background").forEach((el) => el.remove());
});

it("a refused updatePreferences({theme}) shows one Dialog with the ruling's text", async () => {
	stubFullStorage();

	let threw: unknown;
	try {
		await updatePreferences({theme: ThemeOption.Light});
	} catch (e) {
		threw = e;
	}

	await vi.waitFor(() => {
		expect(dialogTexts()).toEqual([EXPECTED_COPY]);
	});
	expect(threw).toBeUndefined();
});

it("a second refused setting write in the same session shows no second Dialog", async () => {
	stubFullStorage();

	await updatePreferences({theme: ThemeOption.Light}).catch(() => {});
	await vi.waitFor(() => {
		expect(dialogTexts()).toEqual([EXPECTED_COPY]);
	});

	await updatePreferences({accentColor: "#123456"}).catch(() => {});
	setSkinTone(3);
	setDeveloperSettings(new DeveloperSettings({showTraces: true}));
	setLocalSettings(new LocalSettings({serviceWorkerMode: ServiceWorkerMode.Enabled}));
	setBotConfigs("example.test", {b1: BOT_HIDE_TAG});
	await flushAsyncDialog();

	expect(dialogTexts()).toEqual([EXPECTED_COPY]);
});

it("after a refused write, getPreferences and getSensitiveContentSync read through the session overlay", async () => {
	stubFullStorage();

	await updatePreferences({theme: ThemeOption.Light}).catch(() => {});
	await setSensitiveContent({nsfw: "block"}).catch(() => {});
	expect((await getPreferences()).theme).toBe(ThemeOption.Light);
	expect(getSensitiveContentSync().nsfw).toBe("block");

	setSkinTone(4);
	setDeveloperSettings(new DeveloperSettings({gatewayLogging: true}));
	setLocalSettings(new LocalSettings({serviceWorkerMode: ServiceWorkerMode.OfflineOnly}));
	setBotConfigs("example.test", {b1: BOT_HIDE_TAG});
	MarkDown.trustedDomains = new Set(["trusted.example.test"]);
	MarkDown.saveTrusted(true);

	expect(getSkinTone()).toBe(4);
	expect(getDeveloperSettings().gatewayLogging).toBe(true);
	expect(getLocalSettings().serviceWorkerMode).toBe(ServiceWorkerMode.OfflineOnly);
	expect(getBotConfigs("example.test")).toEqual({b1: BOT_HIDE_TAG});
	expect(MarkDown.getTrusted().has("trusted.example.test")).toBe(true);
});

it("a later write that lands clears the overlay so readItem equals localStorage", async () => {
	localStorage.setItem(
		"userPreferences",
		JSON.stringify(new UserPreferences({theme: ThemeOption.Dark})),
	);
	const setItemSpy = stubFullStorage();

	await updatePreferences({theme: ThemeOption.Light}).catch(() => {});
	expect((await getPreferences()).theme).toBe(ThemeOption.Light);

	setItemSpy.mockRestore();
	await updatePreferences({theme: ThemeOption.Fuzzy});
	expect((await getPreferences()).theme).toBe(ThemeOption.Fuzzy);

	// Directly replacing localStorage proves the overlay entry was deleted on the write that landed.
	const direct = JSON.stringify(new UserPreferences({theme: ThemeOption.White}));
	localStorage.setItem("userPreferences", direct);
	expect(readItem("userPreferences")).toBe(localStorage.getItem("userPreferences"));
	expect((await getPreferences()).theme).toBe(ThemeOption.White);
});

it("setItem throwing a TypeError rethrows from saveSetting with no Dialog and no overlay", async () => {
	const bug = new TypeError("caller bug");
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw bug;
	});

	expect(() => saveSetting("userPreferences", "{}")).toThrow(bug);
	expect(() => setSkinTone(2)).toThrow(bug);
	expect(() => setBotConfigs("example.test", {b1: 1})).toThrow(bug);
	await flushAsyncDialog();
	expect(dialogTexts()).toEqual([]);
	expect(getSkinTone()).toBe(0);
});

it("quiet sites log a refused write without throwing or showing a Dialog, and rethrow a TypeError", async () => {
	const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw quota();
	});

	const ch = Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		owner: {localuser: {userinfo: {uid: "u1"}}},
	}) as InstanceType<typeof Channel>;

	expect(() => ch.setDraft("hello draft")).not.toThrow();
	expect(() => bumpCommandRecency("300/ping")).not.toThrow();
	expect(errorSpy).toHaveBeenCalledTimes(2);

	showChangelogPopup({force: true});
	const okBtn = document.querySelector<HTMLButtonElement>(".changelogDialog button");
	expect(okBtn).not.toBeNull();
	expect(() => okBtn!.click()).not.toThrow();

	await flushAsyncDialog();
	expect(dialogTexts()).toEqual([]);
	expect(errorSpy).toHaveBeenCalledTimes(3);

	const bug = new TypeError("caller bug");
	setItemSpy.mockImplementation(() => {
		throw bug;
	});
	expect(() => ch.setDraft("hello draft")).toThrow(bug);
	expect(() => bumpCommandRecency("300/ping")).toThrow(bug);
});

it("a browser that blocks storage (SecurityError) keeps the setting for the session but shows no 'storage is full' Dialog", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw new DOMException("", "SecurityError");
	});

	expect(() => setSkinTone(3)).not.toThrow();
	expect(getSkinTone()).toBe(3);
	await flushAsyncDialog();
	expect(dialogTexts()).toEqual([]);
});

it("a Dialog that fails to load is logged with no unhandled rejection, and a later refusal shows it", async () => {
	await I18n.done;
	const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw quota();
	});
	const unhandled = vi.fn((event: PromiseRejectionEvent) => event.preventDefault());
	window.addEventListener("unhandledrejection", unhandled);
	onTestFinished(() => window.removeEventListener("unhandledrejection", unhandled));

	// The notify chain rejects the way a chunk that can't load would (offline, or a deploy
	// swapped the chunks under a running page).
	const loadFailure = new Error("chunk failed to load");
	const doneDescriptor = Object.getOwnPropertyDescriptor(I18n, "done")!;
	Object.defineProperty(I18n, "done", {configurable: true, get: () => Promise.reject(loadFailure)});
	try {
		setSkinTone(3);
		// Settled = the chain's failure was either logged or went unhandled.
		await vi.waitFor(() => {
			const logged = errorSpy.mock.calls.some((call) => call.includes(loadFailure));
			expect(logged || unhandled.mock.calls.length > 0).toBe(true);
		});
		// unhandledrejection fires a task after the rejection: wait past it before reading.
		await flushAsyncDialog();
	} finally {
		Object.defineProperty(I18n, "done", doneDescriptor);
	}
	expect(unhandled).not.toHaveBeenCalled();
	expect(errorSpy).toHaveBeenCalledWith(loadFailure);
	expect(dialogTexts()).toEqual([]);

	setSkinTone(4);
	await vi.waitFor(() => {
		expect(dialogTexts()).toEqual([EXPECTED_COPY]);
	});
});

it("a Dialog whose show() throws is logged and a later refusal does not retry", async () => {
	await I18n.done;
	const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw quota();
	});
	const showFailure = new Error("dialog show failed");
	const showSpy = vi.spyOn(Dialog.prototype, "show").mockImplementationOnce(() => {
		throw showFailure;
	});

	setSkinTone(3);
	await vi.waitFor(() => {
		expect(errorSpy).toHaveBeenCalledWith(showFailure);
	});
	expect(dialogTexts()).toEqual([]);

	setSkinTone(4);
	await flushAsyncDialog();
	expect(dialogTexts()).toEqual([]);
	expect(showSpy).toHaveBeenCalledTimes(1);
});
