import {beforeEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {installNotifyBanner} = await import("./notifyBanner");

const KEY = "notifyBannerDismissed";

/** The markup app.html ships for the bar, plus the two competing rules that bit the first
 * version: .flexltr's author-origin display:flex vs the bar's own [hidden] rule (the
 * #gimmefile precedent). A wholesale stylesheet rewrite is the phone walk's problem; this
 * pins the mechanism. */
function mount() {
	document.head.insertAdjacentHTML(
		"beforeend",
		`<style>.flexltr { display: flex; } #notifyBanner[hidden] { display: none; }</style>`,
	);
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

beforeEach(() => {
	localStorage.removeItem(KEY);
	document.getElementById("notifyBanner")?.remove();
});

it("shows while permission is unset and wasn't dismissed", () => {
	vi.spyOn(Notification, "permission", "get").mockReturnValue("default");
	const banner = mount();

	installNotifyBanner();

	expect(banner.hidden).toBe(false);
	// The property isn't the render: .flexltr's display:flex would beat [hidden] if the
	// stylesheet ever lost its own [hidden] rule (#gimmefile precedent).
	expect(getComputedStyle(banner).display).not.toBe("none");
});

it("stays hidden when the permission is already decided", () => {
	for (const decided of ["granted", "denied"] as const) {
		const banner = mount();
		vi.spyOn(Notification, "permission", "get").mockReturnValue(decided);

		installNotifyBanner();

		expect(banner.hidden).toBe(true);
		// Computed, not just the property: the bar must not render (style.css's own
		// #notifyBanner[hidden] rule does this).
		expect(getComputedStyle(banner).display).toBe("none");
		banner.remove();
	}
});

it("the Enable tap asks the browser and hides the bar on the answer", async () => {
	vi.spyOn(Notification, "permission", "get").mockReturnValue("default");
	const ask = vi.spyOn(Notification, "requestPermission").mockResolvedValue("granted");
	const banner = mount();
	installNotifyBanner();

	document.getElementById("notifyBannerAsk")!.click();

	await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
	await vi.waitFor(() => expect(banner.hidden).toBe(true));
	expect(localStorage.getItem(KEY)).toBeNull();
});

it("the dismiss tap hides the bar and sticks", () => {
	vi.spyOn(Notification, "permission", "get").mockReturnValue("default");
	const banner = mount();
	installNotifyBanner();
	expect(banner.hidden).toBe(false);

	document.getElementById("notifyBannerDismiss")!.click();

	expect(banner.hidden).toBe(true);
	expect(localStorage.getItem(KEY)).toBe("1");
});

it("a dismissed bar stays down on the next boot", () => {
	localStorage.setItem(KEY, "1");
	vi.spyOn(Notification, "permission", "get").mockReturnValue("default");
	const banner = mount();

	installNotifyBanner();

	expect(banner.hidden).toBe(true);
});
