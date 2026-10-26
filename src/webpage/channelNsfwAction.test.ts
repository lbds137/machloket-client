import {beforeEach, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");

beforeEach(() => {
	localStorage.clear();
});

/** A minimal nsfw channel: nsfwGated reads nsfw, perminfo.nsfwOk and the user's
 * nsfw_allowed flag (channel.ts) plus the stored nsfw action (localStorage). The
 * accessor-backed fields (guild/perminfo/localuser) are defined as own properties:
 * Object.assign cannot write them (guild has only a getter, perminfo's setter
 * needs a real guild store). */
function nsfwChannel(nsfwAllowed: boolean | undefined, nsfwOk: boolean) {
	const channel = Object.assign(Object.create(Channel.prototype), {
		nsfw: true,
	}) as InstanceType<typeof Channel>;
	Object.defineProperty(channel, "guild", {value: {perminfo: {channels: {}}}});
	Object.defineProperty(channel, "perminfo", {value: {prevchannel: undefined, nsfwOk}});
	Object.defineProperty(channel, "localuser", {value: {user: {nsfw_allowed: nsfwAllowed}}});
	return channel;
}

it("a non-nsfw channel is never gated, whatever the stored action", async () => {
	localStorage.setItem("userPreferences", JSON.stringify({nsfwAction: "block"}));
	const channel = nsfwChannel(true, false);
	(channel as {nsfw: boolean}).nsfw = false;
	expect(channel.nsfwGated()).toBe(false);
});

it("blur (the default) keeps today's gate: ask until confirmed, never pass a disallowed user", async () => {
	const allowedUnconfirmed = nsfwChannel(true, false);
	expect(allowedUnconfirmed.nsfwGated()).toBe(true);

	const allowedConfirmed = nsfwChannel(true, true);
	expect(allowedConfirmed.nsfwGated()).toBe(false);

	const disallowed = nsfwChannel(false, true);
	expect(disallowed.nsfwGated()).toBe(true);

	const unknown = nsfwChannel(undefined, true);
	expect(unknown.nsfwGated()).toBe(true);
});

it("show drops the per-entry ask for an allowed user but never overrides the server's flag", async () => {
	localStorage.setItem("userPreferences", JSON.stringify({nsfwAction: "show"}));

	const allowedUnconfirmed = nsfwChannel(true, false);
	expect(allowedUnconfirmed.nsfwGated()).toBe(false);

	const disallowed = nsfwChannel(false, true);
	expect(disallowed.nsfwGated()).toBe(true);

	const unknown = nsfwChannel(undefined, true);
	expect(unknown.nsfwGated()).toBe(true);
});

it("block gates the channel even for an allowed, confirmed user", async () => {
	localStorage.setItem("userPreferences", JSON.stringify({nsfwAction: "block"}));

	const allowedConfirmed = nsfwChannel(true, true);
	expect(allowedConfirmed.nsfwGated()).toBe(true);
});

it("a stored action that is not one of show/blur/block falls back to blur", async () => {
	localStorage.setItem("userPreferences", JSON.stringify({nsfwAction: "invalid"}));

	const allowedUnconfirmed = nsfwChannel(true, false);
	expect(allowedUnconfirmed.nsfwGated()).toBe(true);
});
