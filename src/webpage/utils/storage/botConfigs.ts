import {readItem, saveSetting} from "./settingOverlay.js";

/** Per-instance bot display settings, flag bits keyed by the bot's id. */
export const BOT_HIDE_TAG = 1;

const key = (host: string) => "botConfigs_" + host;

/** The stored settings; anything else stored there (corrupt, or not a map) reads as none. */
export function getBotConfigs(host: string): Record<string, number> {
	try {
		const stored: unknown = JSON.parse(readItem(key(host)) ?? "{}");
		if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
		return Object.fromEntries(
			Object.entries(stored).filter(([, flags]) => typeof flags === "number"),
		) as Record<string, number>;
	} catch {
		return {};
	}
}

export function setBotConfigs(host: string, configs: Record<string, number>) {
	saveSetting(key(host), JSON.stringify(configs));
}
