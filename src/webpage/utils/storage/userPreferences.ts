import type {NotificationSoundConfig} from "../notificationSound.js";
import {readItem, saveSetting} from "./settingOverlay.js";
import {trySetItem} from "./trySetItem.js";

// Async in order to account for maybe some day Spacebar supporting account data...
export const enum AnimateTristateValue {
	Always = "always",
	OnlyOnHover = "hover",
	Never = "never",
}
export const AnimateTristateValues = [
	AnimateTristateValue.Always,
	AnimateTristateValue.OnlyOnHover,
	AnimateTristateValue.Never,
];

export const enum ThemeOption {
	Dark = "Dark",
	White = "WHITE",
	Light = "Light",
	DarkAccent = "Dark-Accent",
	Onyx = "Onyx",
	Fuzzy = "Fuzzy",
}
export const ThemeOptionValues = [
	ThemeOption.Dark,
	ThemeOption.White,
	ThemeOption.Light,
	ThemeOption.DarkAccent,
	ThemeOption.Onyx,
	ThemeOption.Fuzzy,
];

export type ContentAction = "show" | "blur" | "block";
export const ContentActionValues: ContentAction[] = ["show", "blur", "block"];

export class UserPreferences {
	/** Bump when a stored-shape change needs a migration; getPreferences will be the hook
	 * that reads it (nothing does yet). Stores written before this field existed read as
	 * the default via Object.assign leaving it untouched. */
	version: number = 1;

	locale: string = navigator.language || "en";

	// render settings
	animateIcons: AnimateTristateValue = AnimateTristateValue.OnlyOnHover;
	animateGifs: AnimateTristateValue = AnimateTristateValue.OnlyOnHover;
	renderJoinAvatars: boolean = true;
	theme: ThemeOption = ThemeOption.Onyx;
	accentColor: string = "#5865F2";
	emojiFont?: string;
	spoilerAction: ContentAction = "blur";
	nsfwAction: ContentAction = "blur";

	notificationSound: string = "Default";
	notificationVolume: number = 75;
	customNotificationSounds: NotificationSoundConfig[] = [];

	constructor(init?: Partial<UserPreferences>) {
		Object.assign(this, init);
	}
}

function readPreferences(): UserPreferences {
	try {
		return new UserPreferences(JSON.parse(readItem("userPreferences") || "{}"));
	} catch (error) {
		// i18n awaits this at module load: a corrupt store must not kill boot. Defaults win;
		// the next setPreferences overwrites the bad payload.
		console.warn("userPreferences store is malformed, using defaults", error);
		return new UserPreferences();
	}
}

export async function getPreferences(): Promise<UserPreferences> {
	return readPreferences();
}

export async function setPreferences(prefs: UserPreferences): Promise<void> {
	trySetItem("userPreferences", JSON.stringify(prefs));
}

export async function updatePreferences(patch: Partial<UserPreferences>): Promise<void> {
	// The read and write stay in one tick because Options.submit runs handlers synchronously.
	const prefs = readPreferences();
	Object.assign(prefs, patch);
	saveSetting("userPreferences", JSON.stringify(prefs));
}

//region Migration from untyped storage
// Runs on every boot. It writes only when something changed (a full store refuses the write,
// and this module is awaited at load, so a throw here stops the app booting), and it drops a
// legacy key only once its value is saved in userPreferences.
async function migrateOldPreferences(): Promise<void> {
	const prefs = await getPreferences();
	const migratedKeys: string[] = [];

	const oldAnimateGifs = localStorage.getItem("gifSetting");
	if (oldAnimateGifs !== null) {
		prefs.animateGifs = oldAnimateGifs as AnimateTristateValue;
		migratedKeys.push("gifSetting");
	}

	const oldAnimateIcons = localStorage.getItem("iconSetting");
	if (oldAnimateIcons !== null) {
		prefs.animateIcons = oldAnimateIcons as AnimateTristateValue;
		migratedKeys.push("iconSetting");
	}

	const oldTheme = localStorage.getItem("theme");
	if (oldTheme !== null) {
		prefs.theme = oldTheme as ThemeOption;
		migratedKeys.push("theme");
	}

	const oldLocale = localStorage.getItem("locale");
	if (oldLocale !== null) {
		prefs.locale = oldLocale;
		migratedKeys.push("locale");
	}

	const oldEmojiFont = localStorage.getItem("emoji-font");
	if (oldEmojiFont !== null) {
		prefs.emojiFont = oldEmojiFont;
		migratedKeys.push("emoji-font");
	}

	let volumeChanged = false;
	const userinfosRaw = localStorage.getItem("userinfos");
	if (userinfosRaw) {
		try {
			const userinfos = JSON.parse(userinfosRaw) as {preferences?: {volume?: number}};
			const oldVolume = userinfos.preferences?.volume;
			if (oldVolume !== undefined && prefs.notificationVolume === 75 && oldVolume !== 75) {
				prefs.notificationVolume = oldVolume;
				volumeChanged = true;
			}
			// The legacy userinfos.preferences.notisound maps to "Default" whatever it holds,
			// which is already the default: nothing to carry over.
		} catch {
			// ignore malformed userinfos
		}
	}

	if (migratedKeys.length === 0 && !volumeChanged) return;
	if (trySetItem("userPreferences", JSON.stringify(prefs))) {
		for (const key of migratedKeys) localStorage.removeItem(key);
	}
}

await migrateOldPreferences();
//endregion
