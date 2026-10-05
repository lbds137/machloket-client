/**
 * A signed CDN link (its `ex` is the expiry in ms, hex) is re-signed once it has less than this
 * left, so a page doesn't start loading a link that expires mid-request.
 */
export const CDN_LINK_MARGIN_MS = 5000;

export function trimTrailingSlashes(uri: string) {
	if (!uri) return uri;
	return uri.replace(/\/+$/, "");
}

/** Whether a URL's host is this machine (by name or address), judged on the host alone. */
export function isLoopback(str: string) {
	if (!URL.canParse(str)) return false;
	const host = new URL(str).hostname;
	return (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		/^127(\.\d{1,3}){3}$/.test(host) ||
		host === "[::1]"
	);
}

/** A CSS `url()` for a URL from the server: quotes, backslashes and line breaks are escaped,
 * so the value can't end the url() early and add another. */
export function cssUrl(url: string) {
	return `url("${url.replace(/["\\\n\r\f]/g, (c) => "\\" + c.charCodeAt(0).toString(16) + " ")}")`;
}
