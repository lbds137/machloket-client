// A deployment's own instances, merged into the public instance list at build and dev-serve
// time (vite.config.js). The public `public/instances.json` stays generic; a deployment that
// keeps its own list in the git-ignored `docs/local/instances.json` gets those entries
// first, so the picker's default (the first entry matching the page's scheme,
// getDefaultInstanceUrl) is its own instance. Build-time only: the app never imports this.

export type ListedInstance = {
	name: string;
	url: string;
	icon?: string;
	description?: string;
};

/** The overlay's entries first, then the public ones whose URL the overlay doesn't already
 * list (the overlay's entry wins a shared URL). No overlay: the public list, unchanged. */
export function mergeInstanceLists<T extends ListedInstance>(
	publicList: T[],
	overlay: ListedInstance[] | undefined,
): ListedInstance[] {
	if (overlay === undefined) return publicList;
	if (
		!Array.isArray(overlay) ||
		!overlay.every(
			(entry) =>
				entry && typeof entry.name === "string" && typeof entry.url === "string" && entry.url,
		)
	) {
		throw new Error("The instance overlay must be a list of {name, url} entries");
	}
	// "http://x:3001/" and "http://x:3001" name the same instance.
	const key = (url: string) => url.replace(/\/+$/, "");
	const own = new Set(overlay.map((entry) => key(entry.url)));
	return [...overlay, ...publicList.filter((entry) => !own.has(key(entry.url)))];
}
