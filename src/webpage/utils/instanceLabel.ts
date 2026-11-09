/**
 * What a page may show for a link's `?instance=`: the host of an http(s) address, or the host of
 * a listed instance's address when the value is that instance's name (`names`: lowercased name →
 * URL, as utils' getStringURLMap). Anything else is undefined: whoever writes the link writes
 * `?instance=`, so its raw text would let a link put any sentence on the page.
 */
export function instanceLabel(
	well: string,
	names: ReadonlyMap<string, string>,
): string | undefined {
	return hostOf(well) ?? hostOf(names.get(well.trim().toLowerCase()));
}

function hostOf(url: string | undefined): string | undefined {
	if (!url || !URL.canParse(url)) return undefined;
	const parsed = new URL(url);
	// data:, javascript: and the like parse with an empty host.
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
	return parsed.host || undefined;
}
