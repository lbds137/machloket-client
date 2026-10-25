import {describe, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first), so load that before the helper.
await import("../localuser");
const {resolveTypedMentions} = await import("./typedMentions");

describe("resolveTypedMentions", () => {
	it("converts an exact @username to <@id>", () => {
		const candidates = [{id: "101", names: ["Alpha"]}];
		expect(resolveTypedMentions("@Alpha hello", candidates)).toBe("<@101> hello");
		expect(resolveTypedMentions("hi @Alpha", candidates)).toBe("hi <@101>");
	});

	it("converts an exact @nick to <@id>", () => {
		const candidates = [{id: "102", names: ["alpha_user", "AlphaNick"]}];
		expect(resolveTypedMentions("ping @AlphaNick now", candidates)).toBe("ping <@102> now");
	});

	it("matches a candidate name containing a space, picking the longest match", () => {
		const candidates = [
			{id: "101", names: ["Alpha"]},
			{id: "103", names: ["alpha_two", "Alpha One"]},
		];
		expect(resolveTypedMentions("hey @Alpha One there", candidates)).toBe("hey <@103> there");
		expect(resolveTypedMentions("hey @Alpha there", candidates)).toBe("hey <@101> there");
	});

	it("keeps a case difference literal", () => {
		const candidates = [{id: "101", names: ["Alpha"]}];
		expect(resolveTypedMentions("@alpha hello", candidates)).toBe("@alpha hello");
	});

	it("keeps an ambiguous nick literal when shared by multiple candidates", () => {
		const candidates = [
			{id: "101", names: ["alice", "SharedNick"]},
			{id: "102", names: ["bob", "SharedNick"]},
		];
		expect(resolveTypedMentions("@SharedNick hello", candidates)).toBe("@SharedNick hello");
	});

	it("keeps an unknown @name literal", () => {
		const candidates = [{id: "101", names: ["Alpha"]}];
		expect(resolveTypedMentions("@Nobody hi", candidates)).toBe("@Nobody hi");
	});

	it("leaves mid-word a@b and existing <@123> / <@!123> mentions untouched", () => {
		const candidates = [
			{id: "123", names: ["b", "123"]},
			{id: "456", names: ["!123"]},
		];
		expect(resolveTypedMentions("mail a@b or <@123> or <@!123>", candidates)).toBe(
			"mail a@b or <@123> or <@!123>",
		);
	});

	it("never converts @everyone or @here", () => {
		const candidates = [
			{id: "101", names: ["everyone"]},
			{id: "102", names: ["here"]},
		];
		expect(resolveTypedMentions("@everyone and @here", candidates)).toBe("@everyone and @here");
	});

	it("short-circuits on empty candidates", () => {
		expect(resolveTypedMentions("@Alpha", [])).toBe("@Alpha");
	});

	it("keeps an unterminated <@ at end-of-string literal", () => {
		const candidates = [{id: "101", names: ["Alpha"]}];
		expect(resolveTypedMentions("hello <", candidates)).toBe("hello <");
		expect(resolveTypedMentions("hi <@101", candidates)).toBe("hi <@101");
	});

	it("handles emoji beside and inside names without splitting surrogates", () => {
		const candidates = [
			{id: "104", names: ["🚀Alpha"]},
			{id: "101", names: ["Alpha"]},
		];
		expect(resolveTypedMentions("go @🚀Alpha now", candidates)).toBe("go <@104> now");
		expect(resolveTypedMentions("go🚀@Alpha", candidates)).toBe("go🚀@Alpha");
	});

	it("consumes an ambiguous longer name whole instead of matching a unique prefix", () => {
		const candidates = [
			{id: "101", names: ["Alpha"]},
			{id: "103", names: ["Alpha One"]},
			{id: "104", names: ["Alpha One"]},
		];
		expect(resolveTypedMentions("hey @Alpha One there", candidates)).toBe(
			"hey @Alpha One there",
		);
	});
});
