import {afterEach, describe, expect, it, vi} from "vitest";

await import("./localuser");
const {I18n} = await import("./i18n");
await I18n.done;

afterEach(async () => {
	vi.unstubAllGlobals();
	await I18n.create("en");
});

describe("translations", () => {
	it("a failed translation fetch falls back to English instead of hanging the app", async () => {
		vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));

		await I18n.create("fr");

		expect(I18n.lang).toBe("en");
		expect(I18n.inbox.markAsRead()).toBe("Mark as read");
	});

	it("English needs no fetch at all", async () => {
		const fetchSpy = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
		vi.stubGlobal("fetch", fetchSpy);

		await I18n.create("en");

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(I18n.inbox.markAsRead()).toBe("Mark as read");
	});
});
