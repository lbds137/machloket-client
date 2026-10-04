import {afterEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {I18n} = await import("./i18n");
await I18n.done;

/** A user with the inbox menu open on "unread", whose unread channels `channels()` lists. */
function inboxUser(channels: () => {id: string; mentions: number; lastmessageid?: string; lastreadmessageid?: string}[]) {
	const build = vi.fn(async (): Promise<never[]> => []);
	const menu = document.createElement("div");
	document.body.append(menu);
	const user = Object.assign(Object.create(Localuser.prototype), {
		inboxMenu: menu,
		inboxTab: "unread",
		inboxBuildToken: 0,
		inboxChannels: channels,
		inboxTitle: () => "#general",
		inboxSubtitle: () => "Server",
		buildInboxEntries: build,
	}) as InstanceType<typeof Localuser>;
	return {user, menu, build};
}

afterEach(() => document.querySelectorAll("body > div").forEach((e) => e.remove()));

describe("the open inbox", () => {
	it("doesn't rebuild on a dispatch that changed nothing it shows (typing, presence)", async () => {
		const {user, build} = inboxUser(() => [{id: "c1", mentions: 0, lastmessageid: "10"}]);
		user.refreshInboxMenu();
		await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(1));

		user.refreshInboxMenu();
		user.refreshInboxMenu();
		await new Promise((res) => setTimeout(res, 20));

		expect(build).toHaveBeenCalledTimes(1);
	});

	it("rebuilds when an unread channel changes, keeping the old list up meanwhile", async () => {
		let last = "10";
		const {user, menu, build} = inboxUser(() => [{id: "c1", mentions: 0, lastmessageid: last}]);
		user.refreshInboxMenu();
		await vi.waitFor(() => expect(menu.textContent).toContain(I18n.inbox.noUnreadChannels()));
		let finish!: (entries: never[]) => void;
		vi.mocked(build).mockImplementationOnce(() => new Promise((res) => (finish = res)));

		last = "11";
		user.refreshInboxMenu();

		expect(build).toHaveBeenCalledTimes(2);
		expect(menu.textContent).toContain(I18n.inbox.noUnreadChannels());
		expect(menu.textContent).not.toContain("Loading...");
		finish([]);
	});

	it("rebuilds when a partial read moves the first unread message (the preview)", async () => {
		const channel = {id: "c1", mentions: 0, lastmessageid: "20", lastreadmessageid: "10"};
		const {user, build} = inboxUser(() => [channel]);
		user.refreshInboxMenu();
		await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(1));

		channel.lastreadmessageid = "15";
		user.refreshInboxMenu();

		expect(build).toHaveBeenCalledTimes(2);
	});

	it("a failed build is retried on the next dispatch", async () => {
		const {user, build} = inboxUser(() => [{id: "c1", mentions: 0, lastmessageid: "10"}]);
		build.mockRejectedValueOnce(new TypeError("Failed to fetch"));
		user.refreshInboxMenu();
		await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(1));
		await new Promise((res) => setTimeout(res, 0));

		user.refreshInboxMenu();

		expect(build).toHaveBeenCalledTimes(2);
	});
});
