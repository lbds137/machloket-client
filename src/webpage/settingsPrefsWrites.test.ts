import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Options} = await import("./settings");
const {I18n} = await import("./i18n");
const {getSensitiveContent, SENSITIVE_CONTENT_ACTIONS} = await import("./utils/sensitiveContent");
const {
	AnimateTristateValue,
	AnimateTristateValues,
	getPreferences,
	setPreferences,
	ThemeOption,
	updatePreferences,
	UserPreferences,
} = await import("./utils/storage/userPreferences");
const {NotificationSoundManager} = await import("./utils/notificationSound");
await I18n.done;

const API = "http://settingsprefs.test/api/v9";

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
	document.body.className = "";
	document.documentElement.style.removeProperty("--accent-color");
	document.documentElement.style.removeProperty("--emoji-font");
	localStorage.clear();
});

/** A Localuser with only the fields the settings builders read. */
function settingsUser(rights: string[] = []) {
	return Object.assign(Object.create(Localuser.prototype), {
		info: {api: API, cdn: "", wellknown: "http://settingsprefs.test"},
		headers: {Authorization: "t"},
		user: {
			id: "me",
			pronouns: "",
			bio: {rawString: ""},
			getpfpsrc: () => "",
			clone: () => ({
				pronouns: "",
				bio: "",
				buildprofile: async () => document.createElement("div"),
			}),
		},
		rights: {allow: 0, hasPermission: (perm: string) => rights.includes(perm)},
		inrelation: new Set(),
		channelids: new Map(),
		userinfo: {localuserStore: {guilds: {}, channels: {}, user: {}}},
		userMap: new Map(),
		guilds: [],
		trace: [],
	}) as unknown as InstanceType<typeof Localuser>;
}

/** Stubs every build-time GET of showusersettings. */
function stubUserSettings() {
	captureRequests(API + "/users/@me/connections", () => Response.json([]));
	captureRequests(API + "/connections", () => Response.json({github: {enabled: true}}));
	captureRequests(API + "/teams", () => Response.json([]));
	captureRequests(API + "/applications", () => Response.json([]));
	captureRequests(API + "/policies/instance/", () => Response.json({instanceName: "T"}));
	captureRequests(API + "/auth/sessions", () => Response.json({user_sessions: []}));
}

type CapturedSelect = {
	label: string;
	options: readonly string[];
	index: number;
	select: WeakRef<HTMLSelectElement>;
	submit(): void;
};

type CapturedColor = {
	label: string;
	input: WeakRef<HTMLInputElement>;
	submit(): void;
};

async function openSettings() {
	stubUserSettings();
	vi.spyOn(NotificationSoundManager, "playFromPreferences").mockResolvedValue();
	const selects = vi.spyOn(Options.prototype, "addSelect");
	const colors = vi.spyOn(Options.prototype, "addColorInput");
	await settingsUser().showusersettings();
	const selectByLabel = (label: string) => {
		const found = selects.mock.results
			.map((r) => r.value as CapturedSelect)
			.find((s) => s?.label === label);
		expect(found, `select ${label} was built`).toBeDefined();
		return found!;
	};
	const colorByLabel = (label: string) => {
		const found = colors.mock.results
			.map((r) => r.value as CapturedColor)
			.find((c) => c?.label === label);
		expect(found, `color input ${label} was built`).toBeDefined();
		return found!;
	};
	return {selectByLabel, colorByLabel};
}

function changeSelect(select: CapturedSelect, index: number) {
	const el = select.select.deref()!;
	el.selectedIndex = index;
	el.dispatchEvent(new Event("change"));
}

function changeColor(color: CapturedColor, value: string) {
	const el = color.input.deref()!;
	el.value = value;
	el.dispatchEvent(new Event("input"));
	color.submit();
}

it("keeps NSFW and spoiler Block selections after later volume or accent writes", async () => {
	const {selectByLabel, colorByLabel} = await openSettings();
	const blockIndex = SENSITIVE_CONTENT_ACTIONS.indexOf("block");

	changeSelect(selectByLabel(I18n.localuser.nsfwContent()), blockIndex);
	await vi.waitFor(async () => {
		expect((await getSensitiveContent()).nsfw).toBe("block");
	});

	const volume = document.querySelector<HTMLInputElement>('input[type="range"]');
	expect(volume).not.toBeNull();
	volume!.value = "40";
	volume!.dispatchEvent(new Event("change"));
	await vi.waitFor(async () => {
		expect((await getPreferences()).notificationVolume).toBe(40);
	});
	expect((await getSensitiveContent()).nsfw).toBe("block");

	changeSelect(selectByLabel(I18n.localuser.spoilerContent()), blockIndex);
	await vi.waitFor(async () => {
		expect((await getSensitiveContent()).spoilers).toBe("block");
	});

	changeColor(colorByLabel(I18n.localuser.accentColor()), "#123456");
	await vi.waitFor(async () => {
		expect((await getPreferences()).accentColor).toBe("#123456");
	});
	expect(await getSensitiveContent()).toEqual({spoilers: "block", nsfw: "block"});
});

it("persists a theme change from the theme select (control)", async () => {
	const {selectByLabel} = await openSettings();
	const themeSelect = selectByLabel(I18n.localuser["theme:"]());
	const lightIndex = themeSelect.options.indexOf(I18n.localuser.themeNames.Light());
	expect(lightIndex).toBeGreaterThanOrEqual(0);

	changeSelect(themeSelect, lightIndex);
	themeSelect.submit();
	await vi.waitFor(() => {
		expect(document.body.className).toBe("Light-theme");
	});

	expect((await getPreferences()).theme).toBe(ThemeOption.Light);
});

it("persists both theme and accent when their submits run synchronously together", async () => {
	const {selectByLabel, colorByLabel} = await openSettings();
	const themeSelect = selectByLabel(I18n.localuser["theme:"]());
	const accentInput = colorByLabel(I18n.localuser.accentColor());
	const lightIndex = themeSelect.options.indexOf(I18n.localuser.themeNames.Light());
	expect(lightIndex).toBeGreaterThanOrEqual(0);

	changeSelect(themeSelect, lightIndex);
	const colorEl = accentInput.input.deref()!;
	colorEl.value = "#abcdef";
	colorEl.dispatchEvent(new Event("input"));

	themeSelect.submit();
	accentInput.submit();

	await vi.waitFor(async () => {
		expect((await getPreferences()).accentColor).toBe("#abcdef");
	});
	expect((await getPreferences()).theme).toBe(ThemeOption.Light);
});

it("persists both GIF and icon animation selects when their submits run synchronously together", async () => {
	const {selectByLabel} = await openSettings();
	const gifSelect = selectByLabel(I18n.accessibility.playGif());
	const iconSelect = selectByLabel(I18n.accessibility.playIcon());

	changeSelect(gifSelect, AnimateTristateValues.indexOf(AnimateTristateValue.Always));
	changeSelect(iconSelect, AnimateTristateValues.indexOf(AnimateTristateValue.Never));

	gifSelect.submit();
	iconSelect.submit();

	await vi.waitFor(async () => {
		expect((await getPreferences()).animateIcons).toBe(AnimateTristateValue.Never);
	});
	expect((await getPreferences()).animateGifs).toBe(AnimateTristateValue.Always);
});

it("persists an accent color change (control)", async () => {
	const {colorByLabel} = await openSettings();

	changeColor(colorByLabel(I18n.localuser.accentColor()), "#abcdef");

	await vi.waitFor(async () => {
		expect((await getPreferences()).accentColor).toBe("#abcdef");
	});
});

it("omits emojiFont from the stored preferences object when cleared to none", async () => {
	await setPreferences(new UserPreferences({emojiFont: "Twemoji"}));
	expect(JSON.parse(localStorage.getItem("userPreferences") || "{}")).toHaveProperty(
		"emojiFont",
		"Twemoji",
	);
	const {selectByLabel} = await openSettings();
	const emojiSelect = selectByLabel(I18n.emojiSelect());

	changeSelect(emojiSelect, 0);
	emojiSelect.submit();

	await vi.waitFor(async () => {
		expect((await getPreferences()).emojiFont).toBeUndefined();
	});
	const stored = JSON.parse(localStorage.getItem("userPreferences") || "{}") as Record<
		string,
		unknown
	>;
	expect(stored).not.toHaveProperty("emojiFont");
});

it("setLanguage does not clobber an accentColor write that lands while I18n.create is in flight", async () => {
	let resolveCreate!: () => void;
	const createSpy = vi.spyOn(I18n, "create").mockImplementation(
		() =>
			new Promise<void>((r) => {
				resolveCreate = r;
			}),
	);

	I18n.setLanguage("fr");
	await vi.waitFor(() => {
		expect(createSpy).toHaveBeenCalledWith("fr");
	});

	await updatePreferences({accentColor: "#112233"});
	resolveCreate();

	await vi.waitFor(async () => {
		expect((await getPreferences()).locale).toBe("fr");
	});
	expect((await getPreferences()).accentColor).toBe("#112233");
});
