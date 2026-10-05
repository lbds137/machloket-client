import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {SnowFlake} = await import("./snowflake");
const {Message} = await import("./message");
await (
	await import("./i18n")
).I18n.done;

afterEach(() => {
	vi.restoreAllMocks();
	document.getElementById("realbox")?.remove();
});

const me = {id: "u1"};
const sent = (id: string, author: {id: string}, at: number) => ({
	id,
	author,
	getTimeStamp: () => at,
});

/** A slowmode channel (60 s) the user can't bypass, with its composer on the page. */
function slowChannel(history: ReturnType<typeof sent>[]) {
	const realbox = document.createElement("div");
	realbox.id = "realbox";
	document.body.append(realbox);
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "200",
		owner: {id: "100", info: {api: "http://slow.test/api/v9"}, localuser: {user: me}},
		headers: {},
		rate_limit_per_user: 60,
		messages: new Map(history.map((m) => [m.id, m])),
		idToPrev: new Map(history.slice(1).map((m, i) => [m.id, history[i].id])),
		idToNext: new Map(history.slice(0, -1).map((m, i) => [m.id, history[i + 1].id])),
		lastmessage: history.at(-1),
		hasPermission: () => false,
		infinite: {snapBottom() {}},
	}) as InstanceType<typeof Channel>;
	return {channel, realbox};
}

it("counts down from the user's own last message, even when someone spoke since", async () => {
	const {channel, realbox} = slowChannel([
		sent("1", me, Date.now() - 10_000), // mine, 10 s ago: 50 s to wait
		sent("2", {id: "u2"}, Date.now() - 5_000),
	]);

	await channel.slowmode();

	expect(realbox.classList.contains("cantSendMessage")).toBe(true);
});

it("a refused send with no earlier message of the user's to find doesn't throw", async () => {
	const {channel} = slowChannel([sent("2", {id: "u2"}, Date.now() - 5_000)]);
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({messages: [], total_results: 0}));

	await expect(channel.slowmode(true)).resolves.toBeUndefined();
});

it("a refused send counts down from the user's last message found by search in this channel", async () => {
	const {channel, realbox} = slowChannel([sent("2", {id: "u2"}, Date.now() - 5_000)]);
	const mine = {
		id: SnowFlake.DateToID(new Date(Date.now() - 10_000)),
		channel_id: "200",
		author: {id: "u1", username: "me"},
		content: "hi",
		timestamp: new Date(Date.now() - 10_000).toISOString(),
		attachments: [],
		embeds: [],
		mentions: [],
	};
	const asked = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValue(Response.json({messages: [[mine]], total_results: 1}));
	// Building a whole Message needs the app's user cache; the countdown reads its timestamp.
	const built = vi.spyOn(Message.prototype, "giveData").mockImplementation(function (
		this: {timestamp: string},
		json: {timestamp: string},
	) {
		this.timestamp = json.timestamp;
	});

	await channel.slowmode(true);

	expect(String(asked.mock.calls[0][0])).toContain("/channels/200/messages/search");
	expect(built).toHaveBeenCalledWith(mine);
	expect(channel.messages.has(mine.id)).toBe(false); // a search hit isn't loaded history
	expect(realbox.classList.contains("cantSendMessage")).toBe(true);
});
