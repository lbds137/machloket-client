import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {NotificationHandler} = await import("./notificationHandler");
type Message = import("./message").Message;

afterEach(async () => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	NotificationHandler.constructorWorks = true;
	for (const registration of await navigator.serviceWorker.getRegistrations()) {
		await registration.unregister();
	}
});

function fakeMessage() {
	const getHTML = vi.fn();
	const message = {
		id: "m1",
		content: {makeHTML: () => ({textContent: "hi"}), textContent: "hi"},
		embeds: [],
		getimages: () => [],
		author: {getpfpsrc: () => "/icon.png"},
		guild: {},
		channel: {id: "c1", guild_id: "g1", name: "general", notititle: () => "#general", getHTML},
	} as unknown as Message;
	return {message, getHTML};
}

/** Android Chrome: the page may not construct notifications at all. */
class AndroidNotification {
	static permission = "granted";
	constructor() {
		throw new TypeError(
			"Failed to construct 'Notification': Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead.",
		);
	}
}

function captureShown() {
	const shown: {script?: string; title: string; options?: NotificationOptions}[] = [];
	vi.spyOn(ServiceWorkerRegistration.prototype, "showNotification").mockImplementation(
		async function (this: ServiceWorkerRegistration, title: string, options?: NotificationOptions) {
			const worker = this.active ?? this.waiting ?? this.installing;
			shown.push({script: worker?.scriptURL, title, options});
		},
	);
	vi.spyOn(ServiceWorkerRegistration.prototype, "getNotifications").mockResolvedValue([]);
	return shown;
}

it("on Android, a message notification shows through a notifications-only service worker", async () => {
	vi.stubGlobal("Notification", AndroidNotification);
	const shown = captureShown();
	const {message} = fakeMessage();

	await NotificationHandler.sendMessageNotification(message).catch(() => {});

	expect(shown).toHaveLength(1);
	expect(shown[0].title).toBe("#general");
	expect(shown[0].options).toMatchObject({body: "hi", tag: "m1", data: {url: "/channels/g1/c1"}});
	// The default mode has no caching worker; this one only shows and opens notifications.
	expect(new URL(shown[0].script!).pathname + new URL(shown[0].script!).search).toBe(
		"/service.js?notifications",
	);
});

it("tapping it on Android opens the message's channel", async () => {
	vi.stubGlobal("Notification", AndroidNotification);
	captureShown();
	const {message, getHTML} = fakeMessage();
	await NotificationHandler.sendMessageNotification(message).catch(() => {});

	// The worker's notificationclick hands the tap to the page by tag.
	navigator.serviceWorker.dispatchEvent(
		new MessageEvent("message", {data: {code: "notificationClick", tag: "m1"}}),
	);

	expect(getHTML).toHaveBeenCalledWith(true, true);
});

it("where the page can construct notifications (desktop), it does, and registers no worker", async () => {
	const constructed: string[] = [];
	vi.stubGlobal(
		"Notification",
		class extends EventTarget {
			static permission = "granted";
			constructor(title: string) {
				super();
				constructed.push(title);
			}
			close() {}
		},
	);
	const shown = captureShown();
	const {message} = fakeMessage();

	await NotificationHandler.sendMessageNotification(message);

	expect(constructed).toEqual(["#general"]);
	expect(shown).toHaveLength(0);
	expect(await navigator.serviceWorker.getRegistrations()).toHaveLength(0);
});

it("a tap on a notification shown before the page (re)loaded opens its channel", async () => {
	const opened: string[] = [];
	NotificationHandler.openChannel = (id) => opened.push(id);
	NotificationHandler.listenForClicks();

	// The worker hands over the notification's data; this page kept no handler for the tag.
	navigator.serviceWorker.dispatchEvent(
		new MessageEvent("message", {data: {code: "notificationClick", tag: "old", channelId: "c7"}}),
	);

	expect(opened).toEqual(["c7"]);
});

it("on Android, a burst of messages clumps instead of stacking one notification each", async () => {
	vi.stubGlobal("Notification", AndroidNotification);
	const shown = captureShown();
	const channel = fakeMessage().message.channel;
	const burst = Array.from({length: 6}, (_, i) => ({
		...fakeMessage().message,
		id: "b" + i,
		channel,
	}));

	await Promise.all(burst.map((m) => NotificationHandler.sendMessageNotification(m as Message)));

	// Four individual notifications, then the channel's clump (one tag, replaced in place).
	expect(new Set(shown.map((s) => s.options?.tag)).size).toBe(5);
});

it("with a caching mode on but no worker running, a notification fails instead of waiting forever", async () => {
	const {SW} = await import("./utils/utils");
	const {getLocalSettings, setLocalSettings} = await import("./utils/storage/localSettings");
	const settings = getLocalSettings();
	const mode = settings.serviceWorkerMode;
	settings.serviceWorkerMode = "enabled" as never;
	setLocalSettings(settings);
	try {
		const outcome = await Promise.race([
			SW.notificationRegistration().then(
				() => "resolved",
				() => "failed",
			),
			new Promise((res) => setTimeout(() => res("still waiting"), 2000)),
		]);
		expect(outcome).toBe("failed");
	} finally {
		settings.serviceWorkerMode = mode;
		setLocalSettings(settings);
	}
});
