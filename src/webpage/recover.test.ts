import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {I18n} = await import("./i18n");
const {openRecovery} = await import("./recover");
await I18n.done;

const before = location.href;
afterEach(() => {
	history.replaceState(history.state, "", before);
	document.body.replaceChildren();
});

it("a reset link's token leaves the address bar and still reaches the reset request", async () => {
	// No token in the answer: a session answer would navigate the test page to /login.
	const sent = captureRequests("http://picked.test/api/v9/auth/reset", () => Response.json({}));
	history.replaceState(history.state, "", "?x=1#token=reset-secret");

	openRecovery({api: "http://picked.test/api/v9"});

	// The token is a password-equivalent: it must not stay in history, bookmarks or a shared
	// screenshot of the address bar.
	expect(location.hash).toBe("");
	expect(location.search).toBe("?x=1");

	const passwords = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')];
	expect(passwords).toHaveLength(2);
	for (const input of passwords) {
		input.value = "new-password";
		input.dispatchEvent(new Event("input"));
	}
	const submit = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent === I18n.submit(),
	);
	submit!.click();
	await vi.waitUntil(() => sent.length > 0, {timeout: 2000});

	expect(sent[0]).toEqual({token: "reset-secret", password: "new-password"});
});
