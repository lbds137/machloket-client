/**
 * A signed CDN link (its `ex` is the expiry in ms, hex) is re-signed once it has less than this
 * left, so a page doesn't start loading a link that expires mid-request.
 */
export const CDN_LINK_MARGIN_MS = 5000;

export function trimTrailingSlashes(uri: string) {
	if (!uri) return uri;
	return uri.replace(/\/+$/, "");
}

export function isLoopback(str: string) {
	return str.includes("localhost") || str.includes("127.0.0.1");
}
