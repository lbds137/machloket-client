import {describe, expect, it} from "vitest";
import type {channeljson} from "./jsontypes.js";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Group} = await import("./direct");

/** A group DM with only what updateChannel reads; its name span is rendered. */
function groupDM() {
	const span = document.createElement("span");
	span.textContent = "Alice, Bob";
	const group = Object.assign(Object.create(Group.prototype), {
		id: "dm1",
		guild_id: "@me",
		name: "Alice, Bob",
		users: [{name: "Alice"}, {name: "Bob"}],
		owner: {localuser: {channelids: new Map()}, roleids: new Map()},
		nameSpan: new WeakRef(span),
		all: new WeakRef(document.createElement("div")),
		permission_overwrites: new Map(),
		renderIcon: () => {},
		slowmode: () => {},
		makeIcon: () => document.createElement("div"),
		fireEvents: () => {},
	}) as InstanceType<typeof Group>;
	return {group, span};
}

/** A group DM's CHANNEL_UPDATE (an icon change): no guild_id, and no name for an unnamed group. */
const update = {id: "dm1", type: 3, icon: "newicon", owner_id: "u1"} as unknown as channeljson;

describe("a group DM's mention badge on the rail", () => {
	it("comes back on a new mention after it was cleared", () => {
		const rail = document.createElement("div");
		rail.id = "sentdms";
		document.body.append(rail);
		const {group} = groupDM();
		try {
			group.mentions = 1;
			group.unreads();
			group.mentions = 0;
			group.unreads();

			group.mentions = 2;
			group.unreads();

			expect(rail.querySelector(".notiunread")?.textContent).toBe("2");
		} finally {
			rail.remove();
		}
	});
});

describe("a group DM update", () => {
	it("stays in the DM list (guild @me)", () => {
		const {group} = groupDM();

		group.updateChannel(update);

		expect(group.guild_id).toBe("@me");
	});

	it("an unnamed group keeps its member-list name", () => {
		const {group, span} = groupDM();

		group.updateChannel(update);

		expect(group.name).toBe("Alice, Bob");
		expect(span.textContent).toBe("Alice, Bob");
	});

	it("a rename takes the new name", () => {
		const {group, span} = groupDM();

		group.updateChannel({...update, name: "Book club"} as channeljson);

		expect(group.name).toBe("Book club");
		expect(span.textContent).toBe("Book club");
	});
});
