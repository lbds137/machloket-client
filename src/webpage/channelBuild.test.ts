import {afterEach, expect, it, onTestFinished, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");

afterEach(() => {
	vi.restoreAllMocks();
});

/** The focused channel's view, with its scroller and jump stubbed: records where each build
 * of the message list was centred. */
function focusedChannel() {
	for (const id of ["scrollWrap", "loadingdiv"]) {
		const el = document.createElement("div");
		el.id = id;
		document.body.append(el);
		onTestFinished(() => el.remove());
	}
	const builtAround: string[] = [];
	const localuser: {channelfocus?: unknown} = {};
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "200",
		owner: {localuser},
		messages: new Map([["3", {id: "3"}]]),
		idToPrev: new Map(),
		idToNext: new Map(),
		lastreadmessageid: "3",
		infinite: {
			getDiv: async (id: string) => {
				builtAround.push(id);
				return document.createElement("div");
			},
		},
		focus: async () => {},
	}) as InstanceType<typeof Channel>;
	localuser.channelfocus = channel;
	return {channel, builtAround};
}

it("a message arriving while a jump looks up its target doesn't take the jump's place", async () => {
	const {channel, builtAround} = focusedChannel();
	let found!: () => void;
	vi.spyOn(channel, "getmessage").mockReturnValueOnce(
		new Promise((res) => (found = () => res(undefined))),
	);

	const jump = channel.buildmessages("5"); // a link to a message not loaded yet
	// A message arrives meanwhile (messageCreate builds the list when none is being built).
	const arrival = channel.infinitefocus ? undefined : channel.tryfocusinfinate();
	found();
	await Promise.all([jump, arrival]);

	expect(builtAround).toEqual(["5"]);
});

it("a build for a channel no longer in view lets the next visit build again", async () => {
	const {channel} = focusedChannel();
	channel.localuser.channelfocus = undefined;

	await channel.tryfocusinfinate();

	expect(channel.infinitefocus).toBe(false);
});

it("a failed jump at the end of a build takes the skeleton down and lets the next build run", async () => {
	const {channel} = focusedChannel();
	document.getElementById("loadingdiv")!.classList.add("loading");
	Object.assign(channel, {focus: () => Promise.reject(new TypeError("Failed to fetch"))});

	await channel.tryfocusinfinate().catch(() => {});

	expect(document.getElementById("loadingdiv")!.classList.contains("loading")).toBe(false);
	expect(channel.infinitefocus).toBe(false);
});

it("a build overtaken by something other than a newer build lets the next one run", async () => {
	const {channel} = focusedChannel();
	let found!: () => void;
	vi.spyOn(channel, "getmessage").mockReturnValueOnce(
		new Promise((res) => (found = () => res(undefined))),
	);

	const jump = channel.buildmessages("5");
	Channel.genid++; // re-opening the channel already in view bumps the generation, builds nothing
	found();
	await jump;

	expect(channel.infinitefocus).toBe(false);
});
