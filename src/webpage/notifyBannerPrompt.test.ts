import {afterEach, beforeEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {installNotifyBanner} = await import("./notifyBanner");
const {Channel} = await import("./channel");
const {NotificationSoundManager} = await import("./utils/notificationSound");
const {NotificationHandler} = await import("./notificationHandler");

const KEY = "notifyBannerDismissed";

/** The markup app.html ships for the bar. No test CSS: the bar's hide is the stylesheet's job,
 * and this test is about the state the bar reads, not the rendering. */
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

beforeEach(() => {
	localStorage.removeItem(KEY);
	document.getElementById("notifyBanner")?.remove();
});

afterEach(() => {
	vi.restoreAllMocks();
	document.getElementById("notifyBanner")?.remove();
});

// AUDIT B-F4 (introduced by 7487a72c): the bar hides only on its own Enable tap's answer. A
// permission granted through Channel.notify's prompt (the gateway-driven ask) leaves the bar up
// although the permission is now decided.
it("the bar hides once a message's prompt is granted, not only on the bar's own tap", async () => {
	vi.spyOn(NotificationSoundManager, "playFromPreferences").mockResolvedValue(undefined);
	vi.spyOn(NotificationHandler, "sendMessageNotification").mockResolvedValue(undefined);
	let permission: NotificationPermission = "default";
	vi.spyOn(Notification, "permission", "get").mockImplementation(() => permission);
	vi.spyOn(Notification, "requestPermission").mockImplementation(async () => {
		permission = "granted";
		return "granted";
	});
	const banner = mount();
	installNotifyBanner();
	expect(banner.hidden).toBe(false);

	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "200",
		owner: {muted: false, message_notifications: 0, localuser: {status: "online"}},
		mute_config: null,
		message_notifications: 0,
	}) as InstanceType<typeof Channel>;
	channel.notify({author: {relationshipType: 0}} as never);

	await vi.waitFor(() => expect(Notification.requestPermission).toHaveBeenCalledTimes(1));
	await new Promise((res) => setTimeout(res, 50));
	expect(banner.hidden).toBe(true);
});

/** Runs Channel.notify's prompt flow with the browser answering `answer` (the permission still
 * reads "default" until a decision lands), and returns the bar once the flow has settled. */
async function promptSettlesWith(answer: NotificationPermission) {
	vi.spyOn(NotificationSoundManager, "playFromPreferences").mockResolvedValue(undefined);
	vi.spyOn(NotificationHandler, "sendMessageNotification").mockResolvedValue(undefined);
	vi.spyOn(Notification, "permission", "get").mockReturnValue("default");
	vi.spyOn(Notification, "requestPermission").mockResolvedValue(answer);
	const banner = mount();
	installNotifyBanner();
	expect(banner.hidden).toBe(false);

	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "201",
		owner: {muted: false, message_notifications: 0, localuser: {status: "online"}},
		mute_config: null,
		message_notifications: 0,
	}) as InstanceType<typeof Channel>;
	channel.notify({author: {relationshipType: 0}} as never);

	await vi.waitFor(() => expect(Notification.requestPermission).toHaveBeenCalledTimes(1));
	await new Promise((res) => setTimeout(res, 50));
	return banner;
}

// AUDIT B-F4 follow-up: "default" is no decision. The gateway-driven ask resolves "default" with
// no prompt shown on browsers that need a gesture, which is the case the bar exists for, so the
// bar must stay up. Only a decision (granted or denied) hides it.
it("the bar stays up when the message's prompt resolves default (no decision yet)", async () => {
	const banner = await promptSettlesWith("default");

	expect(banner.hidden).toBe(false);
});

it("the bar hides when the message's prompt is denied", async () => {
	const banner = await promptSettlesWith("denied");

	expect(banner.hidden).toBe(true);
});
