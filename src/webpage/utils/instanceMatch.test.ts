import {expect, it} from "vitest";
import {sameApi, sameInstance} from "./instanceMatch";

it("matches an account to the instance asked for by host, bare or as a URL", () => {
	expect(sameInstance("https://spacebar.chat", "spacebar.chat")).toBe(true);
	expect(sameInstance("https://spacebar.chat/", "https://spacebar.chat")).toBe(true);
	expect(sameInstance("http://lan.test:3001", "lan.test:3001")).toBe(true);
});

it("doesn't match on a fragment of the host", () => {
	expect(sameInstance("https://spacebar.chat", "chat")).toBe(false);
	expect(sameInstance("https://notspacebar.chat", "spacebar.chat")).toBe(false);
	expect(sameInstance("https://spacebar.chat.evil.example", "spacebar.chat")).toBe(false);
});

it("compares API bases exactly, give or take a trailing slash", () => {
	expect(sameApi("https://a.test/api/v9/", "https://a.test/api/v9")).toBe(true);
	expect(sameApi("https://a.test/api/v9", "https://a.test/api")).toBe(false);
});
