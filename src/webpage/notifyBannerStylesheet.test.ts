import {afterEach, beforeEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {installNotifyBanner} = await import("./notifyBanner");

const KEY = "notifyBannerDismissed";

/** The stylesheet the app ships, read from its source file: the rule that hides the bar must be
 * the one in this file, not a copy the test injects. */
async function shippedCss() {
	const res = await fetch(new URL("./public/style.css", import.meta.url));
	expect(res.ok).toBe(true);
	return res.text();
}

/** The markup app.html ships for the bar. */
function mount() {
	document.body.insertAdjacentHTML(
		"afterbegin",
		`<div id="notifyBanner" class="flexltr notifyBanner" hidden>
			<span i18n="notifyBannerText"></span>
			<button id="notifyBannerAsk" i18n="notifyBannerEnable"></button>
			<button id="notifyBannerDismiss">✕</button>
		</div>`,
	);
	return document.getElementById("notifyBanner")!;
}

let style: HTMLStyleElement;

beforeEach(async () => {
	localStorage.removeItem(KEY);
	style = document.createElement("style");
	style.textContent = await shippedCss();
	document.head.append(style);
});

afterEach(() => {
	vi.restoreAllMocks();
	style.remove();
	document.getElementById("notifyBanner")?.remove();
});

// AUDIT B-F5 (introduced by 7487a72c): notifyBanner.test.ts injects its own `[hidden]` rule, so
// it never pins the rule that ships in style.css, and the commit's claim that it does was false.
// These tests load the shipped stylesheet and check the rendered display.
it("the shipped stylesheet keeps the bar down when its permission is decided", () => {
	vi.spyOn(Notification, "permission", "get").mockReturnValue("granted");
	const banner = mount();

	installNotifyBanner();

	expect(banner.hidden).toBe(true);
	// .flexltr's display:flex must not win over the bar's [hidden] rule in the shipped sheet.
	expect(getComputedStyle(banner).display).toBe("none");
});

it("the shipped stylesheet shows the bar while its permission is unset", () => {
	vi.spyOn(Notification, "permission", "get").mockReturnValue("default");
	const banner = mount();

	installNotifyBanner();

	expect(banner.hidden).toBe(false);
	expect(getComputedStyle(banner).display).toBe("flex");
});
