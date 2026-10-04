import {afterEach, describe, expect, it, vi} from "vitest";

await import("./localuser");
const {SW} = await import("./utils/utils");
const {NotificationSoundManager} = await import("./utils/notificationSound");
const {ServiceWorkerMode, getLocalSettings, setLocalSettings} = await import("./utils/storage/localSettings");

afterEach(() => vi.unstubAllGlobals());

describe("choosing the unregistered service-worker mode", () => {
	it("doesn't throw when no worker was ever registered (the default)", () => {
		const before = getLocalSettings();
		try {
			expect(() => SW.setMode(ServiceWorkerMode.Unregistered)).not.toThrow();
		} finally {
			setLocalSettings(before);
		}
	});
});

describe("a notification sound that fails to load", () => {
	it("is tried again on the next play instead of staying silent", async () => {
		const fetchSpy = vi.fn(async () => new Response("<html>not found</html>", {status: 404}));
		vi.stubGlobal("fetch", fetchSpy);
		const getBuffer = (NotificationSoundManager as unknown as {getBuffer: (p: string) => Promise<unknown>})
			.getBuffer.bind(NotificationSoundManager);

		await expect(getBuffer("/sounds/missing.mp3")).rejects.toThrow();
		await expect(getBuffer("/sounds/missing.mp3")).rejects.toThrow();

		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});
});

describe("who reacted", () => {
	it("asks for a custom emoji by name:id and a unicode one encoded", async () => {
		const {reactionPathSegment} = await import("./message");

		expect(reactionPathSegment({name: "partyblob", id: "900"})).toBe("partyblob:900");
		expect(reactionPathSegment({name: "👍"})).toBe(encodeURIComponent("👍"));
		expect(reactionPathSegment({name: "a/b?c"})).toBe("a%2Fb%3Fc");
	});
});
