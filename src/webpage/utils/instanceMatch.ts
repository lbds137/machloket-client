import {trimTrailingSlashes} from "./netUtils";

/** `host[:port]` of a URL, or of a bare host such as an `?instance=` value ("spacebar.chat"). */
function hostOf(str: string) {
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(str) ? str : "https://" + str;
	return URL.canParse(withScheme) ? new URL(withScheme).host : undefined;
}

/**
 * Whether an account's well-known URL is the instance a page was asked for. By host, not by
 * substring: "chat" must not pick an account on "spacebar.chat".
 */
export function sameInstance(accountWellknown: string, asked: string) {
	const host = hostOf(asked);
	return host !== undefined && hostOf(accountWellknown) === host;
}

/** Whether two API base URLs are the same, give or take a trailing slash. */
export function sameApi(a: string, b: string) {
	return trimTrailingSlashes(a) === trimTrailingSlashes(b);
}
