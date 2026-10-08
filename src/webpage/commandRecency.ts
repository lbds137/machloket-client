/** Records an invocation as just used, in localStorage under `commandRecency`. The key is
 * the app-scoped invocation path ("300/character browse" — see invocationKey), not a bare
 * command name. */
export function bumpCommandRecency(key: string) {
	try {
		const recency = getCommandRecency();
		recency[key] = Date.now();
		localStorage.setItem("commandRecency", JSON.stringify(recency));
	} catch {
		// A full or blocked storage loses one recency entry; ordering is cosmetic.
	}
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
