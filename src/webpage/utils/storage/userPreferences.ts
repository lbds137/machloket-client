import type {NotificationSoundConfig} from "../notificationSound.js";

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
}
export const ThemeOptionValues = [
	ThemeOption.Dark,
	ThemeOption.White,
	ThemeOption.Light,
	ThemeOption.DarkAccent,
];

export class UserPreferences {
	locale: string = navigator.language || "en";

	// render settings
	animateIcons: AnimateTristateValue = AnimateTristateValue.OnlyOnHover;
	animateGifs: AnimateTristateValue = AnimateTristateValue.OnlyOnHover;
	renderJoinAvatars: boolean = true;
	theme: ThemeOption = ThemeOption.Dark;
	accentColor: string = "#5865F2";
	emojiFont?: string;

	notificationSound: string = "Default";
	notificationVolume: number = 75;
	customNotificationSounds: NotificationSoundConfig[] = [];

	constructor(init?: Partial<UserPreferences>) {
		Object.assign(this, init);
	}
}

export async function getPreferences(): Promise<UserPreferences> {
	return new UserPreferences(JSON.parse(localStorage.getItem("userPreferences") || "{}"));
}

export async function setPreferences(prefs: UserPreferences): Promise<void> {
	localStorage.setItem("userPreferences", JSON.stringify(prefs));
}

//region Migration from untyped storage
async function migrateOldPreferences(): Promise<void> {
	const prefs = await getPreferences();
	let mod = false;

	const oldAnimateGifs = localStorage.getItem("gifSetting");
	if (oldAnimateGifs !== null) {
		prefs.animateGifs = oldAnimateGifs as AnimateTristateValue;
		localStorage.removeItem("gifSetting");
		mod = true;
	}

	const oldAnimateIcons = localStorage.getItem("iconSetting");
	if (oldAnimateIcons !== null) {
		prefs.animateIcons = oldAnimateIcons as AnimateTristateValue;
		localStorage.removeItem("iconSetting");
		mod = true;
	}

	const oldTheme = localStorage.getItem("theme");
	if (oldTheme !== null) {
		prefs.theme = oldTheme as ThemeOption;
		localStorage.removeItem("theme");
		mod = true;
	}

	const oldLocale = localStorage.getItem("locale");
	if (oldLocale !== null) {
		prefs.locale = oldLocale;
		localStorage.removeItem("locale");
		mod = true;
	}

	const oldEmojiFont = localStorage.getItem("emoji-font");
	if (oldEmojiFont !== null) {
		prefs.emojiFont = oldEmojiFont;
		localStorage.removeItem("emoji-font");
		mod = true;
	}

	const userinfosRaw = localStorage.getItem("userinfos");
	if (userinfosRaw) {
		try {
			const userinfos = JSON.parse(userinfosRaw) as {
				preferences?: {notisound?: string; volume?: number};
			};
			if (userinfos.preferences?.volume !== undefined && prefs.notificationVolume === 75) {
				prefs.notificationVolume = userinfos.preferences.volume;
				mod = true;
			}
			if (userinfos.preferences?.notisound !== undefined && prefs.notificationSound === "Default") {
				const oldSound = userinfos.preferences.notisound;
				prefs.notificationSound = oldSound === "custom" ? "Default" : "Default";
				mod = true;
			}
		} catch {
			// ignore malformed userinfos
		}
	}

	if (mod) {
		// TODO: proper saving and versioning and crap...
		localStorage.setItem("userPreferences", JSON.stringify(prefs));
	}
}

await migrateOldPreferences();
//endregion
