import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
await import("./localuser");
const {Dialog, FormError} = await import("./settings");

const URL_ = "http://form.test/thing";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});
}

/** A form posting to URL_ whose onSubmit records what it got. */
function postingForm() {
	const calls: unknown[] = [];
	const form = new Dialog("").options.addForm("", (res: object) => void calls.push(res), {
		fetchURL: URL_,
		method: "POST",
	});
	return {form, calls};
}

/** Lets the form's fetch chain run to its end. */
const settle = () => new Promise((res) => setTimeout(res, 50));

let unhandled: string[] = [];
const onUnhandled = (e: PromiseRejectionEvent) => {
	unhandled.push(String(e.reason));
	e.preventDefault();
};
beforeEach(() => {
	unhandled = [];
	window.addEventListener("unhandledrejection", onUnhandled);
});
afterEach(() => {
	window.removeEventListener("unhandledrejection", onUnhandled);
	document.querySelectorAll("dialog, .PopUp").forEach((e) => e.remove());
});

describe("form submit", () => {
	it("an empty success (204) counts as a success", async () => {
		captureRequests(URL_, () => new Response(null, {status: 204}));
		const {form, calls} = postingForm();

		await form.submit();
		await settle();

		expect(unhandled).toEqual([]);
		expect(calls).toHaveLength(1);
	});

	it("a body that isn't JSON (a proxy's 502 page) fails cleanly and the form can be sent again", async () => {
		const sent = captureRequests(URL_, () => new Response("<html>bad gateway</html>", {status: 502}));
		const {form, calls} = postingForm();

		await form.submit();
		await settle();
		await form.submit();
		await settle();

		expect(unhandled).toEqual([]);
		expect(calls).toEqual([]);
		expect(sent).toHaveLength(2);
	});

	it("a 2FA prompt left open doesn't lock the form: it can be sent again", async () => {
		const loginURL = "http://form.test/api/login";
		const sent = captureRequests(loginURL, () => json({ticket: "t", totp: true}));
		const calls: unknown[] = [];
		const form = new Dialog("").options.addForm("", (res: object) => void calls.push(res), {
			fetchURL: loginURL,
			method: "POST",
		});

		void form.submit();
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		void form.submit();

		await vi.waitFor(() => expect(sent).toHaveLength(2));
		expect(calls).toEqual([]);
	});

	it("a JSON body that isn't an object fails cleanly", async () => {
		captureRequests(URL_, () => new Response("null", {status: 200}));
		const {form, calls} = postingForm();

		await form.submit();
		await settle();

		expect(unhandled).toEqual([]);
		expect(calls).toEqual([]);
	});

	it("an error answer never reaches onSubmit; its message is shown", async () => {
		captureRequests(URL_, () => json({code: 60008, message: "Invalid two-factor code"}, 400));
		const {form, calls} = postingForm();

		await form.submit();
		await settle();

		expect(calls).toEqual([]);
		expect(document.body.textContent).toContain("Invalid two-factor code");
	});

	it("a form's own error handler gets the answer and can put it on a field", async () => {
		captureRequests(URL_, () => json({code: 60008, message: "Invalid two-factor code"}, 400));
		const dialog = new Dialog("");
		const calls: unknown[] = [];
		const form = dialog.options.addForm("", (res: object) => void calls.push(res), {
			fetchURL: URL_,
			method: "POST",
		});
		const code = form.addTextInput("Code", "code");
		dialog.show();
		const seen: [unknown, number][] = [];
		form.onErrorBody = (body, status) => {
			seen.push([body, status]);
			throw new FormError(code, "Wrong code");
		};

		await form.submit();
		await settle();

		expect(calls).toEqual([]);
		expect(seen).toEqual([[{code: 60008, message: "Invalid two-factor code"}, 400]]);
		expect(document.body.textContent).toContain("Wrong code");
	});

	it("a field error the server names is placed on that field, and the form hears of it", async () => {
		captureRequests(URL_, () =>
			json({code: 50035, message: "Invalid Form Body", errors: {name: {_errors: [{message: "Too short"}]}}}, 400),
		);
		const dialog = new Dialog("");
		const form = dialog.options.addForm("", () => {}, {fetchURL: URL_, method: "POST"});
		form.addTextInput("Name", "name");
		dialog.show();
		const heard: string[] = [];
		form.onFormError = (e) => void heard.push(e.message);

		await form.submit();
		await settle();

		expect(heard).toEqual(["Too short"]);
		expect(document.body.textContent).toContain("Too short");
	});

	it("a success whose body has a code of its own (an invite) still reaches onSubmit", async () => {
		captureRequests(URL_, () => json({code: 404, message: "a channel topic"}));
		const {form, calls} = postingForm();

		await form.submit();
		await settle();

		expect(calls).toEqual([{code: 404, message: "a channel topic"}]);
	});

	it("a second tap while the first answer is pending sends nothing", async () => {
		let answer!: () => void;
		const sent = captureRequests(
			URL_,
			() => new Promise<Response>((res) => (answer = () => res(json({ok: true})))),
		);
		const {form, calls} = postingForm();

		const first = form.submit();
		await settle();
		await form.submit();
		answer();
		await first;
		await settle();

		expect(sent).toHaveLength(1);
		expect(calls).toHaveLength(1);
	});
});
