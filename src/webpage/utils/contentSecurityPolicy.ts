// The client's Content-Security-Policy: one source for the deployed `_headers` file (vite.config.js,
// generateBuildFiles) and for the preview server the e2e tier drives, so the tests run under the
// policy that ships. Node-safe: vite.config.js imports this module, so it touches no DOM.
//
// What it buys, and what it doesn't:
// - script-src 'self' with no 'unsafe-inline' or 'unsafe-eval' is the point: injected markup can't
//   run script, and nothing in the bundle needs eval (the build refuses an inline <script> and a
//   Function/eval call in the emitted code). The one other script origin is hCaptcha's, which
//   the client trusts with script whenever an instance asks for a captcha (HCAPTCHA_SCRIPT).
// - Trusted Types: the only HTML the client writes through a string sink is "" (clearing an
//   element); the default policy (utils/trustedTypes.ts) passes exactly that and same-origin
//   script URLs, and refuses the rest.
// - connect-src, img-src and media-src are scheme-wide on purpose: the instances are the user's
//   choice (any host, and a LAN instance is plain http), so this policy does NOT limit where a
//   script that is already running could send data. Its job is stopping that script from running.
// - style-src keeps 'unsafe-inline': each page has a small inline <style>, the theme sheets are
//   injected as <style> elements, and markup carries style attributes. Style injection can't run
//   script.
/** The one script origin besides the client's own: the hCaptcha an instance can ask for at login
 * or registration (settings.ts, Captcha). Its challenge renders in a frame from HCAPTCHA_FRAME.
 * Its script ran under this policy, Trusted Types enforced, with no violation (TASK-135 probe,
 * hCaptcha's public test sitekey; the widget, not an image challenge). */
export const HCAPTCHA_SCRIPT = "https://js.hcaptcha.com";
const HCAPTCHA_FRAME = "https://newassets.hcaptcha.com";

export const CSP_DIRECTIVES: readonly (readonly [string, ...string[]])[] = [
	["default-src", "'self'"],
	["script-src", "'self'", HCAPTCHA_SCRIPT],
	["style-src", "'self'", "'unsafe-inline'"],
	["img-src", "'self'", "https:", "http:", "data:", "blob:"],
	["media-src", "'self'", "https:", "http:", "data:", "blob:"],
	["font-src", "'self'"],
	// data: and blob: for the client's own URLs: an audio file's preview reads the blob: URL of
	// the user's file (media.ts), and saved notification sounds are data: URLs.
	["connect-src", "'self'", "https:", "wss:", "http:", "ws:", "data:", "blob:"],
	// The video embed's player (embed.ts, youtubeEmbedSrc): exactly the hosts it accepts; and the
	// captcha's challenge.
	[
		"frame-src",
		HCAPTCHA_FRAME,
		"https://youtube.com",
		"https://www.youtube.com",
		"https://youtube-nocookie.com",
		"https://www.youtube-nocookie.com",
	],
	["worker-src", "'self'"],
	["manifest-src", "'self'"],
	["object-src", "'none'"],
	["base-uri", "'none'"],
	["form-action", "'none'"],
	["frame-ancestors", "'none'"],
	["require-trusted-types-for", "'script'"],
	["trusted-types", "default"],
];

export const CONTENT_SECURITY_POLICY = CSP_DIRECTIVES.map((directive) => directive.join(" ")).join(
	"; ",
);

/** The Cloudflare Pages `_headers` file: the policy on every path (pages, workers, assets). */
export function pagesHeadersFile(): string {
	return `/*\n  Content-Security-Policy: ${CONTENT_SECURITY_POLICY}\n`;
}
