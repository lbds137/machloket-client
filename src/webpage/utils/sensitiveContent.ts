import {ContentActionValues, type ContentAction, getPreferences, setPreferences} from "./storage/userPreferences";

export type SensitiveContentAction = ContentAction;
export type SensitiveContentSource = "spoilers" | "nsfw";

export interface SensitiveContentSettings {
	spoilers: SensitiveContentAction;
	nsfw: SensitiveContentAction;
}

export const SENSITIVE_CONTENT_ACTIONS = ContentActionValues;

function isAction(value: unknown): value is SensitiveContentAction {
	return value === "show" || value === "blur" || value === "block";
}

function prefField(source: SensitiveContentSource): "spoilerAction" | "nsfwAction" {
	return source === "spoilers" ? "spoilerAction" : "nsfwAction";
}

export async function getSensitiveContent(): Promise<SensitiveContentSettings> {
	const prefs = await getPreferences().catch(() => null);
	return {
		spoilers: isAction(prefs?.spoilerAction) ? prefs.spoilerAction : "show",
		nsfw: isAction(prefs?.nsfwAction) ? prefs.nsfwAction : "show",
	};
}

export async function setSensitiveContent(patch: Partial<SensitiveContentSettings>): Promise<void> {
	const prefs = await getPreferences().catch(() => null);
	if (!prefs) return;
	for (const source of ["spoilers", "nsfw"] as const) {
		const value = patch[source];
		if (isAction(value)) prefs[prefField(source)] = value;
	}
	await setPreferences(prefs);
}

export {getSensitiveContent as get, setSensitiveContent as set};
