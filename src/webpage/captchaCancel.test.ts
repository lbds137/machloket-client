import {afterEach, expect, it} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Captcha, Dialog} = await import("./settings");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://captcha.test/api/v9";

afterEach(() => {
	document.body.replaceChildren();
	Captcha.hcaptcha = undefined;
});

/** The loaded hCaptcha widget (its script never runs here): the answer lands in children[1]'s
 * second child, as the real widget's does. */
function fakeWidget() {
	const widget = document.createElement("div");
	const frame = document.createElement("div");
	frame.append(document.createElement("iframe"), document.createElement("textarea"));
	widget.append(document.createElement("span"), frame);
	return widget;
}

const settled = (p: Promise<unknown>, ms = 400) =>
	Promise.race([p.then(() => "settled"), new Promise((r) => setTimeout(() => r("pending"), ms))]);

it("dismissing the captcha ends the submit, and nothing is sent again", async () => {
	const sent = captureRequests(API + "/auth/register", () =>
		Response.json({captcha_sitekey: "site", captcha_service: "hcaptcha"}, {status: 400}),
	);
	Captcha.hcaptcha = fakeWidget();
	const dialog = new Dialog("");
	const form = dialog.options.addForm("", () => {}, {
		fetchURL: API + "/auth/register",
		method: "POST",
	});
	dialog.show();

	const submitting = form.submit();
	await expect.poll(() => document.querySelectorAll(".background").length).toBe(2);
	const captchaDialog = document.querySelectorAll<HTMLElement>(".background")[1];
	captchaDialog.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));

	expect(await settled(submitting)).toBe("settled");
	expect(sent).toHaveLength(1);
});
