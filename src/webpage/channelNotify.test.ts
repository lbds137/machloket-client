import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {NotificationSoundManager} = await import("./utils/notificationSound");

afterEach(() => vi.restoreAllMocks());

it("a message that asks for notification permission, refused or dismissed, sounds once", async () => {
	const sounds = vi
		.spyOn(NotificationSoundManager, "playFromPreferences")
		.mockResolvedValue(undefined);
	vi.spyOn(Notification, "permission", "get").mockReturnValue("default");
	const asked = vi.spyOn(Notification, "requestPermission").mockResolvedValue("default");
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "200",
		owner: {muted: false, message_notifications: 0, localuser: {status: "online"}},
		mute_config: null,
		message_notifications: 0,
	}) as InstanceType<typeof Channel>;

	channel.notify({author: {relationshipType: 0}} as never);
	await new Promise((res) => setTimeout(res, 50));

	expect(asked).toHaveBeenCalled();
	expect(sounds).toHaveBeenCalledTimes(1);
});

it("a message whose permission prompt is granted shows its notification, with one sound", async () => {
	const {NotificationHandler} = await import("./notificationHandler");
	const sounds = vi
		.spyOn(NotificationSoundManager, "playFromPreferences")
		.mockResolvedValue(undefined);
	vi.spyOn(Notification, "permission", "get").mockReturnValue("default");
	vi.spyOn(Notification, "requestPermission").mockResolvedValue("granted");
	const shown = vi
		.spyOn(NotificationHandler, "sendMessageNotification")
		.mockResolvedValue(undefined);
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "200",
		owner: {muted: false, message_notifications: 0, localuser: {status: "online"}},
		mute_config: null,
		message_notifications: 0,
	}) as InstanceType<typeof Channel>;
	const message = {author: {relationshipType: 0}};

	channel.notify(message as never);
	await new Promise((res) => setTimeout(res, 50));

	expect(shown).toHaveBeenCalledExactlyOnceWith(message);
	expect(sounds).toHaveBeenCalledTimes(1);
});
