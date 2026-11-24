// The Trusted Types default policy. The deployed Content-Security-Policy requires Trusted Types
// for script sinks (utils/contentSecurityPolicy.ts), so every string assigned to innerHTML, or
// passed as a worker's URL, goes through this policy first. It passes the only two shapes the
// client uses and refuses everything else (the browser then blocks the assignment and reports a
// violation):
// - HTML: the empty string, which clears an element. Markup is built with DOM calls instead.
// - Script URLs: same-origin ones (the service worker, the WebKit file-writing worker), and the
//   captcha script an instance can ask for (HCAPTCHA_SCRIPT).
// No createScript: nothing in the client turns a string into code.
//
// The entry (index.ts) imports this module first, and the build puts it in a chunk of its own
// that every page loads before any other (vite.config.js, codeSplitting and policyLastPages).

import {HCAPTCHA_SCRIPT} from "./contentSecurityPolicy";

/** The HTML the default policy lets through, or null to refuse it. */
export function allowedHTML(html: string): string | null {
	return html === "" ? "" : null;
}

/** The script URL the default policy lets through (same-origin, or the captcha's script), or
 * null to refuse it. The scheme must match too: a blob: URL's origin is that of the page that
 * made it, so a user's file turned into a blob: URL would otherwise pass as same-origin. */
export function allowedScriptURL(url: string, base: string = location.href): string | null {
	if (!URL.canParse(url, base)) return null;
	const target = new URL(url, base);
	const page = new URL(base);
	if (target.protocol === page.protocol && target.origin === page.origin) return url;
	return target.protocol === "https:" && target.origin === HCAPTCHA_SCRIPT ? url : null;
}

interface TrustedTypePolicyFactoryLike {
	defaultPolicy: unknown;
	createPolicy(
		name: string,
		rules: {
			createHTML?: (input: string) => string | null;
			createScriptURL?: (input: string) => string | null;
		},
	): unknown;
}

const factory = (globalThis as {trustedTypes?: TrustedTypePolicyFactoryLike}).trustedTypes;
// A browser without Trusted Types enforces none, so it needs no policy.
if (factory && !factory.defaultPolicy) {
	factory.createPolicy("default", {
		createHTML: (input) => allowedHTML(input),
		createScriptURL: (input) => allowedScriptURL(input),
	});
}
