import {afterEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Dialog} = await import("./settings");
const {I18n} = await import("./i18n");
await I18n.done;

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll("dialog, .PopUp, .background, .amsBox").forEach((e) => e.remove());
});

// AUDIT A-F3 (introduced by 308c4408): a 2xx security-key answer whose body parses as JSON but
// is not an object (`null`, `"ok"`, `[]`) must refuse visibly, with the same message as a
// non-JSON 2xx body, instead of ending the login silently (`null`) or throwing inside the
// success path (`"ok"`, `[]`).
describe("AUDIT A-F3: webauthn 2xx with a JSON body that is not an object", () => {
	const URL_ = "http://key.test/api/v9/auth/login";
	const challenge = JSON.stringify({publicKey: {challenge: "abc", allowCredentials: []}});
	function loginForm() {
		captureRequests(URL_, () =>
			Response.json({token: null, mfa: true, webauthn: challenge, ticket: "t1"}),
		);
		vi.spyOn(PublicKeyCredential, "parseRequestOptionsFromJSON").mockReturnValue({} as never);
		const loggedIn = vi.fn();
		const form = new Dialog("").options.addForm("", loggedIn, {fetchURL: URL_, method: "POST"});
		form.addTextInput("Login", "login", {initText: "nyx@example.invalid"});
		return {form, loggedIn};
	}

	it.each([
		["null", null],
		["a string", "ok"],
		["an array", []],
	])("a 2xx key answer that is %s refuses visibly and does not log in", async (_label, body) => {
		const {form, loggedIn} = loginForm();
		const buf = new ArrayBuffer(1);
		vi.spyOn(navigator.credentials, "get").mockResolvedValue({
			rawId: buf,
			response: {authenticatorData: buf, clientDataJSON: buf, signature: buf},
		} as never);
		captureRequests("http://key.test/api/auth/mfa/webauthn", () =>
			Response.json(body, {status: 200}),
		);

		await expect(form.submit()).resolves.toBeUndefined();

		expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 200, bad body"));
		expect(loggedIn).not.toHaveBeenCalled();
	});
});
