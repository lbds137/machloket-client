import {describe, expect, it} from "vitest";
import {allowedHTML, allowedScriptURL} from "./trustedTypes";

// The default policy's rules. The browser-side refusals they cause are pinned in the e2e tier
// (e2e/csp.spec.ts), which runs under the deployed policy.
describe("Trusted Types default policy", () => {
	it("lets only the empty string through as HTML", () => {
		expect(allowedHTML("")).toBe("");
		for (const markup of ["<b>x</b>", " ", "text", "<svg></svg>"]) {
			expect(allowedHTML(markup), JSON.stringify(markup)).toBeNull();
		}
	});

	it("lets only same-origin script URLs through", () => {
		const base = "https://client.example.test/channels/1/2";
		expect(allowedScriptURL("/service.js", base)).toBe("/service.js");
		expect(allowedScriptURL("https://client.example.test/assets/w.js", base)).toBe(
			"https://client.example.test/assets/w.js",
		);
		expect(allowedScriptURL("../assets/w.js", base)).toBe("../assets/w.js");
		// The one third-party script: an instance's captcha (settings.ts, Captcha).
		expect(allowedScriptURL("https://js.hcaptcha.com/1/api.js", base)).toBe(
			"https://js.hcaptcha.com/1/api.js",
		);
		for (const url of [
			"https://evil.example.test/w.js",
			"//evil.example.test/w.js",
			"http://client.example.test/w.js",
			"https://client.example.test:8443/w.js",
			"data:text/javascript,1",
			"blob:https://evil.example.test/0",
			// A blob: URL's origin is its creator's, so this one is same-origin: a user's file.
			"blob:https://client.example.test/0",
			"javascript:1",
			"http://js.hcaptcha.com/1/api.js",
			"https://newassets.hcaptcha.com/x.js",
			"https://js.hcaptcha.com.evil.test/1/api.js",
		]) {
			expect(allowedScriptURL(url, base), url).toBeNull();
		}
	});
});
