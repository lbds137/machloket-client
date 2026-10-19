import {describe, expect, it} from "vitest";
import {API} from "../test/interactionFixture";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first); interactionFixture loads localuser and I18n first.
const {Localuser} = await import("../localuser");
const {Channel} = await import("../channel");
const {User} = await import("../user");
const {I18n} = await import("../i18n");
await I18n.done;

function makeUserJson(id: string, username: string, bot = false) {
	return {
		id,
		username,
		public_flags: 0,
		discriminator: "0000",
		avatar: null,
		accent_color: 0,
		bio: "",
		premium_since: "",
		premium_type: 0,
		bot,
		theme_colors: null,
		badge_ids: [],
	};
}

function testChannel() {
	const info = {api: API, cdn: API, wellknown: API};
	const headers = {"Content-type": "application/json", Authorization: "token"};
	const localuser = Object.assign(Object.create(Localuser.prototype), {
		info,
		headers,
		userMap: new Map(),
		interactionIdLabels: new Map(),
		guilds: [],
		guildids: new Map([["@me", {channels: []}]]),
		channelids: new Map(),
	}) as InstanceType<typeof Localuser>;
	localuser.user = new User(makeUserJson("100", "invoker"), localuser);
	const bot = new User(makeUserJson("1100000000000000300", "RandomBot", true), localuser);
	localuser.userMap.set("1100000000000000300", bot);

	const guild = {id: "@me", localuser, info, roleids: new Map(), getpfpsrc: () => ""};
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "200",
		owner: guild,
		headers,
		messages: new Map(),
		idToPrev: new Map(),
		idToNext: new Map(),
		nonceMap: new Map(),
		infinite: {
			snapBottom: () => () => {},
			addedBottom: async () => {},
			deleteId: () => {},
		},
	}) as InstanceType<typeof Channel>;
	return {localuser, channel};
}

describe("Channel.addCommandFailure", () => {
	it("links an ephemeral failure message from the bot into the channel and renders its dismissible red notice", async () => {
		const {channel} = testChannel();

		await channel.addCommandFailure({
			applicationId: "1100000000000000300",
			label: "random",
			interactionId: "9",
			text: I18n.interactions.noResponse(),
		});

		const m = channel.lastmessage!;
		expect(m).toBeDefined();
		expect(m.id.startsWith("fake")).toBe(true);
		expect(m.ephemeral).toBe(true);
		expect(m.author.id).toBe("1100000000000000300");
		expect(m.usedLabel).toBe("random");
		expect(channel.lastmessageid).toBe(m.id);

		const html = m.buildhtml();
		expect(html.querySelector(".commandFailure")?.textContent).toBe(I18n.interactions.noResponse());
		expect(html.querySelector(".ephemeralDiv")).not.toBeNull();
		expect(html.querySelector(".interactionCommand")?.textContent).toBe("/random");

		html.querySelector<HTMLElement>(".ephemeralDiv a")!.click();
		expect(channel.messages.has(m.id)).toBe(false);
	});
});

it("a read channel stays read after a failure, and its unread state still works", async () => {
	const {channel} = testChannel();
	const read = "1100000000000000500";
	Object.assign(channel, {
		lastmessageid: read,
		lastreadmessageid: read,
		hasPermission: () => true,
	});

	await channel.addCommandFailure({
		applicationId: "1100000000000000300",
		label: "random",
		interactionId: "9",
		text: I18n.interactions.noResponse(),
	});

	let unread: unknown;
	try {
		unread = channel.hasunreads;
	} catch (error) {
		unread = error;
	}
	expect(unread).toBe(false);
});
