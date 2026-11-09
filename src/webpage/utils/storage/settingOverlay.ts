import {isStoreRefusal} from "./trySetItem.js";

// Settings refused by a full store live here for the rest of the session so every reader sees
// the choice the user just made until the page reloads.
const overlay = new Map<string, string>();
let notifiedThisSession = false;
// Bumped only by resetSettingOverlayForTests: a Dialog still loading from an earlier test
// must not open into the next one. In the app it never changes.
let sessionGeneration = 0;

export function readItem(key: string): string | null {
	return overlay.get(key) ?? localStorage.getItem(key);
}

/**
 * Reads a setting stored as a JSON object. Unset reads as {}; a corrupt or non-object value
 * also reads as {} (with a warning), because these readers run at module load and a throw
 * there stops the app booting.
 */
export function readStoredObject(key: string): Record<string, unknown> {
	const raw = readItem(key);
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		console.warn(`${key} store is not an object, using defaults`);
	} catch (error) {
		console.warn(`${key} store is malformed, using defaults`, error);
	}
	return {};
}

function notifySettingNotSaved(): void {
	if (notifiedThisSession) return;
	notifiedThisSession = true;
	const generation = sessionGeneration;
	// Storage modules are awaited at boot (i18n.ts awaits userPreferences.ts), so neither
	// settings.js nor i18n.js may be imported statically from here.
	Promise.all([import("../../settings.js"), import("../../i18n.js")])
		.then(async ([{Dialog}, {I18n}]) => {
			await I18n.done;
			if (generation !== sessionGeneration) return;
			new Dialog(I18n.settingNotSaved()).show();
		})
		.catch((error: unknown) => {
			// A chunk that can't load (offline, or a deploy swapped the chunks): the user hasn't
			// been told yet, so the next refused write tries again.
			console.error(error);
			if (generation === sessionGeneration) notifiedThisSession = false;
		});
}

/**
 * Saves a user-chosen setting to localStorage. When the store refuses the write, keeps the
 * value in the session overlay for readItem and tells the user once per session. Any error
 * that isn't the store's refusal is rethrown with no overlay or dialog.
 */
export function saveSetting(key: string, value: string): boolean {
	try {
		localStorage.setItem(key, value);
		overlay.delete(key);
		return true;
	} catch (error) {
		if (!isStoreRefusal(error)) throw error;
		console.error(error);
		overlay.set(key, value);
		// The Dialog's copy says the storage is full; a browser that blocks storage
		// (SecurityError) keeps the value for the session without it.
		if (error.name === "QuotaExceededError") notifySettingNotSaved();
		return false;
	}
}

export function resetSettingOverlayForTests(): void {
	overlay.clear();
	notifiedThisSession = false;
	sessionGeneration++;
}
