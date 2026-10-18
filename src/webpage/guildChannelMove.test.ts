import {expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Guild} = await import("./guild");

type FakeChannel = {
	id: string;
	position: number;
	parent?: FakeChannel;
	children: FakeChannel[];
	updateChannel(json: {parent_id?: string; position: number}): void;
	resolveparent(): boolean;
};

/** A guild with category "cat" holding "a", and "b" at the top level; channel updates apply
 * their parent the way Channel.updateChannel does. */
function guildWithCategory() {
	const channelids = new Map<string, FakeChannel>();
	const make = (id: string, position: number): FakeChannel => {
		const channel: FakeChannel = {
			id,
			position,
			children: [],
			updateChannel(json) {
				this.position = json.position;
				this.parent = json.parent_id ? channelids.get(json.parent_id) : undefined;
			},
			resolveparent() {
				if (!this.parent) return false;
				this.parent.children.push(this);
				return true;
			},
		};
		channelids.set(id, channel);
		return channel;
	};
	const cat = make("cat", 0);
	const a = make("a", 1);
	const b = make("b", 2);
	a.parent = cat;
	cat.children.push(a);
	const guild = Object.assign(Object.create(Guild.prototype), {
		// `localuser` is a getter on the prototype: it reads the owner.
		owner: {channelids},
		channels: [cat, a, b],
		headchannels: [cat, b],
		printServers: () => {},
	});
	return {guild, cat, a, b};
}

it("a channel moved out of its category shows at the top level, once", () => {
	const {guild, cat, a} = guildWithCategory();

	// Deleting a category first moves each child to the top level.
	guild.updateChannel({id: "a", position: 1});

	expect(cat.children).not.toContain(a);
	expect(guild.headchannels.filter((c: FakeChannel) => c === a)).toHaveLength(1);
});

it("a channel moved into a category leaves the top level", () => {
	const {guild, cat, b} = guildWithCategory();

	guild.updateChannel({id: "b", parent_id: "cat", position: 2});

	expect(cat.children.filter((c) => c === b)).toHaveLength(1);
	expect(guild.headchannels).not.toContain(b);
});
