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

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** A server- or bot-supplied link, parsed, when it is safe to navigate to: web and mail
 * links only. Anything else (javascript:, data:, …) would run in the client's origin, where
 * every account's token lives. */
export function externalUrl(url: string): URL | null {
	if (!URL.canParse(url)) return null;
	const parsed = new URL(url);
	return EXTERNAL_PROTOCOLS.has(parsed.protocol) ? parsed : null;
}

/** An attachment link (instance-supplied, or a blob: preview of a local upload) when it is
 * safe to put on a link: web or blob only. */
export function attachmentUrl(url: string): string | null {
	if (!URL.canParse(url)) return null;
	const {protocol} = new URL(url);
	return protocol === "http:" || protocol === "https:" || protocol === "blob:" ? url : null;
}

/** Where to go after login/register: the page's `?goback=`, resolved against this page and
 * followed only when it stays on this origin (a scheme-relative `//host` or `/\host` is a
 * relative reference that resolves off-site). */
export function postLoginRedirect(redir: string | null): string {
	if (redir && URL.canParse(redir, window.location.href)) {
		const target = new URL(redir, window.location.href);
		if (target.origin === window.location.origin) return target.href;
	}
	return "/channels/@me";
}
