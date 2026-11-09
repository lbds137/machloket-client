import {afterEach, beforeEach, expect, it, vi} from "vitest";

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
const settingOverlay = (await import("./settingOverlay.js")) as {
	readItem?: (key: string) => string | null;
	saveSetting?: (key: string, value: string) => boolean;
	resetSettingOverlayForTests?: () => void;
};

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
	settingOverlay.resetSettingOverlayForTests?.();
	document.querySelectorAll(".background").forEach((el) => el.remove());
});

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.clear();
	settingOverlay.resetSettingOverlayForTests?.();
	document.querySelectorAll(".background").forEach((el) => el.remove());
});

it("1. a refused updatePreferences({theme}) shows one Dialog with the ruling's text", async () => {
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

it("2. a second refused setting write in the same session shows no second Dialog", async () => {
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

it("3. after a refused write, getPreferences and getSensitiveContentSync read through the session overlay", async () => {
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

it("4. a later write that lands clears the overlay so readItem equals localStorage", async () => {
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
	expect(settingOverlay.readItem?.("userPreferences")).toBe(
		localStorage.getItem("userPreferences"),
	);
	expect((await getPreferences()).theme).toBe(ThemeOption.White);
});

it("5. setItem throwing a TypeError rethrows from saveSetting with no Dialog and no overlay", async () => {
	const bug = new TypeError("caller bug");
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw bug;
	});

	expect(() => settingOverlay.saveSetting!("userPreferences", "{}")).toThrow(bug);
	expect(() => setSkinTone(2)).toThrow(bug);
	expect(() => setBotConfigs("example.test", {b1: 1})).toThrow(bug);
	await flushAsyncDialog();
	expect(dialogTexts()).toEqual([]);
	expect(getSkinTone()).toBe(0);
});

it("6. quiet sites log a refused write without throwing or showing a Dialog, and rethrow a TypeError", async () => {
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

it("7. a browser that blocks storage (SecurityError) keeps the setting for the session but shows no 'storage is full' Dialog", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw new DOMException("", "SecurityError");
	});

	expect(() => setSkinTone(3)).not.toThrow();
	expect(getSkinTone()).toBe(3);
	await flushAsyncDialog();
	expect(dialogTexts()).toEqual([]);
});
