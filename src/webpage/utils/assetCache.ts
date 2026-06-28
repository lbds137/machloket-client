const VERSIONED_STYLESHEETS = ["/style.css", "/themes.css"];

export async function fetchFermoVersion(): Promise<string> {
	try {
		const response = await fetch("/getupdates", {cache: "no-store"});
		if (!response.ok) return "dev";
		const text = (await response.text()).trim();
		if (!text || text.toLowerCase().startsWith("<!doctype html") || text.includes("<html")) {
			return "dev";
		}
		return text;
	} catch {
		return "dev";
	}
}

export function applyStylesheetCacheBust(version: string): void {
	const shortVersion = version.slice(0, 12);
	for (const link of Array.from(
		document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
	)) {
		const href = link.getAttribute("href");
		if (!href) continue;
		const url = new URL(href, window.location.href);
		if (!VERSIONED_STYLESHEETS.includes(url.pathname)) continue;
		if (url.searchParams.get("v") === shortVersion) continue;
		url.searchParams.set("v", shortVersion);
		link.href = url.pathname + url.search;
	}
}

export async function refreshStylesheetsForUpdate(): Promise<void> {
	const version = await fetchFermoVersion();
	applyStylesheetCacheBust(version);
}
