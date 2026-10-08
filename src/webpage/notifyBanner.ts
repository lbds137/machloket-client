import {I18n} from "./i18n.js";

const DISMISS_KEY = "notifyBannerDismissed";

/** The "enable notifications" bar: browsers want requestPermission from a user gesture,
 * so the gateway-driven ask is often silently ignored — the bar's tap is the gesture.
 * Shows only while the permission is genuinely unset; dismissing sticks. */
export function installNotifyBanner() {
	const banner = document.getElementById("notifyBanner");
	if (!banner) return;
	try {
		if (localStorage.getItem(DISMISS_KEY) === "1") return;
	} catch {}
	if (!("Notification" in window) || Notification.permission !== "default") return;

	document.getElementById("notifyBannerDismiss")?.setAttribute("aria-label", I18n.dismiss());
	banner.hidden = false;
	document.getElementById("notifyBannerAsk")?.addEventListener("click", () => {
		Notification.requestPermission()
			.finally(() => {
				// Granted, denied or dismissed: the bar has done its job either way.
				banner.hidden = true;
			})
			.catch((e) => console.error("Couldn't ask for notification permission:", e));
	});
	document.getElementById("notifyBannerDismiss")?.addEventListener("click", () => {
		banner.hidden = true;
		try {
			localStorage.setItem(DISMISS_KEY, "1");
		} catch {}
	});
}
