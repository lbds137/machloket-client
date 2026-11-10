import {isStoreRefusal} from "./trySetItem.js";

export const ACCOUNT_HANDOFF_KEY = "machloket.sessionAccounts";

// Settings and accounts refused by a full store live here for the rest of the session so every
// reader sees the choice the user just made until the page reloads.
const overlay = new Map<string, string>();
const notifiedThisSession = new Set<"setting" | "account">();
// Bumped only by resetSettingOverlayForTests: a Dialog still loading from an earlier test
// must not open into the next one. In the app it never changes.
let sessionGeneration = 0;

export function loadAccountHandoff(): void {
	try {
		const handoff = sessionStorage.getItem(ACCOUNT_HANDOFF_KEY);
		if (handoff !== null) overlay.set("userinfos", handoff);
	} catch {
		// Where storage is blocked, reaching sessionStorage throws.
	}
}
loadAccountHandoff();

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

function notifyOnce(kind: "setting" | "account"): void {
	if (notifiedThisSession.has(kind)) return;
	notifiedThisSession.add(kind);
	const generation = sessionGeneration;
	// Storage modules are awaited at boot (i18n.ts awaits userPreferences.ts), so neither
	// settings.js nor i18n.js may be imported statically from here.
	Promise.all([import("../../settings.js"), import("../../i18n.js")])
		.then(async ([{Dialog}, {I18n}]) => {
			await I18n.done;
			return {Dialog, I18n};
		})
		.then(
			({Dialog, I18n}) => {
				if (generation !== sessionGeneration) return;
				const copy = kind === "account" ? I18n.accountNotSaved() : I18n.settingNotSaved();
				new Dialog(copy).show();
			},
			(error: unknown) => {
				// A chunk that can't load (offline, or a deploy swapped the chunks): the user hasn't
				// been told yet, so the next refused write tries again.
				console.error(error);
				if (generation === sessionGeneration) notifiedThisSession.delete(kind);
			},
		)
		.catch((error: unknown) => {
			console.error(error);
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
		if (error.name === "QuotaExceededError") notifyOnce("setting");
		return false;
	}
}

/**
 * The single writer of `userinfos`. When the store refuses the write, keeps the value in the
 * session overlay (and updates any pending navigation handoff) before rethrowing the refusal
 * for callers (`updateLocal`, `proxySave`) that branch on it.
 */
export function writeAccounts(value: string): void {
	try {
		localStorage.setItem("userinfos", value);
		overlay.delete("userinfos");
		try {
			if (sessionStorage.getItem(ACCOUNT_HANDOFF_KEY) !== null) {
				sessionStorage.removeItem(ACCOUNT_HANDOFF_KEY);
			}
		} catch {
			// Where storage is blocked, reaching sessionStorage throws.
		}
	} catch (error) {
		if (!isStoreRefusal(error)) throw error;
		overlay.set("userinfos", value);
		try {
			if (sessionStorage.getItem(ACCOUNT_HANDOFF_KEY) !== null) {
				sessionStorage.setItem(ACCOUNT_HANDOFF_KEY, value);
			}
		} catch (handoffError) {
			console.error(handoffError);
		}
		throw error;
	}
}

export function saveAccounts(value: string, opts?: {signIn?: boolean}): boolean {
	try {
		writeAccounts(value);
		return true;
	} catch (error) {
		if (!isStoreRefusal(error)) throw error;
		console.error(error);
		if (opts?.signIn && error.name === "QuotaExceededError") notifyOnce("account");
		return false;
	}
}

export function carryAccountsAcrossNavigation(): void {
	const value = overlay.get("userinfos");
	if (value === undefined) return;
	try {
		sessionStorage.setItem(ACCOUNT_HANDOFF_KEY, value);
	} catch (error) {
		console.error(error);
	}
}

/** Removes the navigation handoff (its accounts stay in the overlay for this page) and says
 * whether there was one. The app's boot calls it before anything that can throw, so a reload
 * signs a session-only account out even after a failed boot. */
export function consumeAccountHandoff(): boolean {
	try {
		if (sessionStorage.getItem(ACCOUNT_HANDOFF_KEY) !== null) {
			sessionStorage.removeItem(ACCOUNT_HANDOFF_KEY);
			return true;
		}
	} catch (error) {
		console.error(error);
	}
	return false;
}

/** The "signed in for this session only" Dialog, once per session: for the boot, once the
 * account a handoff carried has started. */
export function notifyAccountKeptForSession(): void {
	notifyOnce("account");
}

export function resetSettingOverlayForTests(): void {
	overlay.clear();
	notifiedThisSession.clear();
	sessionGeneration++;
}
