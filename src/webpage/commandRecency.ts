import {trySetItem} from "./utils/storage/trySetItem.js";

/** Records an invocation as just used, in localStorage under `commandRecency`. The key is
 * the app-scoped invocation path ("300/character browse" — see invocationKey), not a bare
 * command name. */
export function bumpCommandRecency(key: string) {
	const recency = getCommandRecency();
	recency[key] = Date.now();
	trySetItem("commandRecency", JSON.stringify(recency));
}

/** The stored recency; anything else stored there (corrupt, or not a map) reads as none. */
export function getCommandRecency(): Record<string, number> {
	try {
		const stored: unknown = JSON.parse(localStorage.getItem("commandRecency") ?? "{}");
		if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
		return Object.fromEntries(
			Object.entries(stored).filter(([, at]) => typeof at === "number"),
		) as Record<string, number>;
	} catch {
		return {};
	}
}
