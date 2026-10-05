import {afterEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Settings, Dialog} = await import("./settings");
const {I18n} = await import("./i18n");
await I18n.done;

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll("dialog, .PopUp, .background, .amsBox").forEach((e) => e.remove());
});

const settled = (p: Promise<unknown>) =>
	Promise.race([p.then(() => "settled"), new Promise((r) => setTimeout(() => r("pending"), 300))]);

it("closed settings leave the page even when animations never run", async () => {
	const settings = new Settings("Settings");
	settings.addButton("Profile");
	settings.show();
	const html = settings.html!;
	// User CSS (or a theme) that turns animations off: no animationend ever comes.
	html.style.animation = "none";

	settings.hide();
	await new Promise((r) => setTimeout(r, 700));

	expect(document.body.contains(html)).toBe(false);
});

it("dismissing the 2FA code prompt ends the login attempt instead of leaving it hanging", async () => {
	const URL_ = "http://tfa.test/api/v9/auth/login";
	captureRequests(URL_, () => Response.json({token: null, mfa: true, totp: true, ticket: "t1"}));
	const loggedIn = vi.fn();
	const form = new Dialog("").options.addForm("", loggedIn, {fetchURL: URL_, method: "POST"});
	form.addTextInput("Login", "login", {initText: "nyx@example.invalid"});

	const submit = form.submit();
	await new Promise((r) => setTimeout(r, 100));
	const prompt = [...document.querySelectorAll<HTMLElement>(".background")].at(-1)!;
	expect(prompt.textContent).toContain(I18n["2faCode"]());
	prompt.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));

	expect(await settled(submit)).toBe("settled");
	expect(loggedIn).not.toHaveBeenCalled();
});

it("two radio selects with the same label are separate choices", () => {
	const options = new Dialog("").options;
	const a = options.addSelect("Size", () => {}, ["Small", "Large"], {radio: true}).generateHTML();
	const b = options
		.addSelect("Size", () => {}, ["Small", "Large"], {radio: true, defaultIndex: 1})
		.generateHTML();
	document.body.append(a, b);

	b.querySelectorAll("input")[0].click();

	expect(a.querySelectorAll("input")[0].checked).toBe(true);
	a.remove();
	b.remove();
});

describe("member search box", () => {
	const after = (ms: number) => new Promise((r) => setTimeout(r, ms));
	/** Answers "a" slowly and anything longer at once, the way a server might. */
	const search = async (term: string) => {
		await after(term === "a" ? 150 : 10);
		return [{name: "match for " + term, value: term}];
	};
	function openBox(searchFunc = search) {
		const onPick = vi.fn();
		const ams = new Dialog("").options.addAsyncMultiSelect("Members", () => {}, searchFunc);
		ams.watchForChange(onPick);
		const html = ams.generateHTML();
		document.body.append(html);
		(html.querySelector(".svg-plus") as HTMLElement).click();
		const input = document.querySelector<HTMLInputElement>(".amsBox input")!;
		const type = (text: string, key = text.at(-1)!) => {
			input.value = text;
			input.dispatchEvent(new KeyboardEvent("keyup", {key}));
		};
		return {ams, type, html};
	}

	it("shows the newest search's results, not a slower older one's", async () => {
		const {type} = openBox();
		type("a");
		type("ab");
		await after(250);

		expect(document.querySelector(".amsBox .reses")!.textContent).toBe("match for ab");
	});

	it("Enter adds the top result for what's typed now", async () => {
		const {ams, type} = openBox();
		await after(30);
		type("ab");
		type("ab", "Enter");
		await after(100);

		expect(ams.value).toEqual(["ab"]);
	});

	it("Enter during a slow search, then more typing, adds the top result for the final text", async () => {
		// "a" answers after 50 ms, "ab" only after 150: the Enter's search is superseded and
		// answers first.
		const {ams, type} = openBox(async (term) => {
			await after(term === "a" ? 50 : term === "ab" ? 150 : 10);
			return [{name: "match for " + term, value: term}];
		});
		await after(30);
		type("a");
		type("a", "Enter");
		type("ab");
		await after(300);

		expect(ams.value).toEqual(["ab"]);
	});
});

describe("security-key second factor", () => {
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

	it("cancelling the key prompt ends the attempt quietly", async () => {
		const {form, loggedIn} = loginForm();
		vi.spyOn(navigator.credentials, "get").mockRejectedValue(
			new DOMException("cancelled", "NotAllowedError"),
		);

		await expect(form.submit()).resolves.toBeUndefined();
		expect(loggedIn).not.toHaveBeenCalled();
	});

	it("a refused key says why", async () => {
		const {form, loggedIn} = loginForm();
		const buf = new ArrayBuffer(1);
		vi.spyOn(navigator.credentials, "get").mockResolvedValue({
			rawId: buf,
			response: {authenticatorData: buf, clientDataJSON: buf, signature: buf},
		} as never);
		const keySent = captureRequests("http://key.test/api/auth/mfa/webauthn", () =>
			Response.json({message: "Invalid security key", code: 60008}, {status: 400}),
		);

		await form.submit();

		expect(keySent).toHaveLength(1);
		expect(loggedIn).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain("Invalid security key");
	});
});
