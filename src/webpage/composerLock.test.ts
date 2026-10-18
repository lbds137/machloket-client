import {afterEach, expect, it, vi} from "vitest";
import type {Member as MemberT} from "./member";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {Guild} = await import("./guild");
const {Member} = await import("./member");
const {Permissions} = await import("./permissions");
await (
	await import("./i18n")
).I18n.done;

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

const bits = (...names: string[]) =>
	names.reduce(
		(total, name) => total | (1n << BigInt(Permissions.permisions.indexOf(name as never))),
		0n,
	) + "";
const role = (id: string, position: number, ...names: string[]) => ({
	id,
	position,
	permissions: new Permissions(bits(...names)),
});

/** The composer's controls, as the page has them. */
function composer() {
	const ids = ["realbox", "typebox", "upload", "gifTB", "stickerTB", "emojiTB", "mobileSend"];
	for (const id of ids) {
		const el = document.createElement("div");
		el.id = id;
		document.body.append(el);
	}
	return document.getElementById("typebox") as HTMLDivElement;
}

/** The user ("u1") reading text channel c1 of guild g1, whose @everyone can view but not send;
 * role "talk" can send. The composer starts as `locked`. */
function reading({locked, nsfw = false}: {locked: boolean; nsfw?: boolean}) {
	const typebox = composer();
	typebox.contentEditable = locked ? "false" : "plaintext-only";
	const localuser = {
		// An NSFW channel stays behind its gate for a user who hasn't allowed NSFW.
		user: {id: "u1", nsfw_allowed: false},
		perminfo: {guilds: {g1: {channels: {c1: {}}}}},
		channelfocus: undefined as unknown,
		lookingguild: undefined as unknown,
	};
	const guild = Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		properties: {owner_id: "owner"},
		roles: [role("talk", 1, "SEND_MESSAGES"), role("g1", 0, "VIEW_CHANNEL")],
		owner: localuser,
	}) as InstanceType<typeof Guild>;
	const member = Object.assign(Object.create(Member.prototype), {
		id: "u1",
		owner: guild,
		roleIds: new Set<string>(),
		user: {id: "u1"},
	}) as MemberT;
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		type: 0,
		owner: guild,
		permission_overwrites: new Map(),
		rate_limit_per_user: 0,
		nsfw,
	}) as InstanceType<typeof Channel>;
	Object.assign(guild, {member});
	localuser.lookingguild = guild;
	localuser.channelfocus = channel;
	return {member, typebox};
}

it("a channel behind the NSFW gate keeps its composer locked whatever the user may send", () => {
	const {member, typebox} = reading({locked: true, nsfw: true});
	const upload = document.getElementById("upload")!;
	upload.style.visibility = "hidden";

	member.update({roles: ["talk"]} as never);

	expect(typebox.contentEditable).toBe("false");
	expect(upload.style.visibility).toBe("hidden");
});

it("given the right to send while reading, the composer unlocks", () => {
	const {member, typebox} = reading({locked: true});

	member.update({roles: ["talk"]} as never);

	expect(typebox.contentEditable).not.toBe("false");
});

it("losing the right to send while reading locks the composer", () => {
	const {member, typebox} = reading({locked: false});
	member.roleIds = new Set(["talk"]);

	member.update({roles: []} as never);

	expect(typebox.contentEditable).toBe("false");
});

it("timed out while reading: the composer locks", () => {
	const {member, typebox} = reading({locked: false});
	member.roleIds = new Set(["talk"]);

	member.update({
		communication_disabled_until: new Date(Date.now() + 60_000).toISOString(),
	} as never);

	expect(typebox.contentEditable).toBe("false");
});

it("a timeout that runs out while reading unlocks the composer", async () => {
	vi.useFakeTimers();
	// Opened while timed out: the composer is locked.
	const {member, typebox} = reading({locked: true});
	member.roleIds = new Set(["talk"]);
	member.update({
		communication_disabled_until: new Date(Date.now() + 3_000).toISOString(),
	} as never);

	await vi.advanceTimersByTimeAsync(5_000);

	expect(typebox.contentEditable).not.toBe("false");
});
