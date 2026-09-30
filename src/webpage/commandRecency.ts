/** Discord's command-popup order: recently used commands first (most recent on top), the
 * never-used remainder alphabetical. `recency` maps command name → last-used epoch ms. */
export function recentFirst<T extends {name: string}>(
	items: T[],
	recency: Record<string, number>,
): T[] {
	return [...items].sort((a, b) => {
		const at = recency[a.name] ?? 0;
		const bt = recency[b.name] ?? 0;
		if (at !== bt) return bt - at;
		return a.name.localeCompare(b.name);
	});
}

/** Records a command as just used, in localStorage under `commandRecency`. */
export function bumpCommandRecency(name: string) {
	try {
		const recency = JSON.parse(localStorage.getItem("commandRecency") ?? "{}") as Record<
			string,
			number
		>;
		recency[name] = Date.now();
		localStorage.setItem("commandRecency", JSON.stringify(recency));
	} catch {
		// A full or blocked storage loses one recency entry; ordering is cosmetic.
	}
}

export function getCommandRecency(): Record<string, number> {
	try {
		return JSON.parse(localStorage.getItem("commandRecency") ?? "{}") as Record<string, number>;
	} catch {
		return {};
	}
}
