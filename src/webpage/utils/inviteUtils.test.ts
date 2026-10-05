import {expect, it} from "vitest";
import {normalizeInviteLink} from "./inviteUtils";

it("rewrites a known instance's invite link to its short form (the control)", () => {
	expect(normalizeInviteLink("https://fermi.chat/invite/abc123")).toBe("https://sbar.fyi/i/abc123");
});

it("leaves a lookalike host alone", () => {
	for (const link of [
		"https://fermi.chat.evil.example/x/invite/abc123",
		"https://fermi.chatty.example/invite/abc123",
	]) {
		expect(normalizeInviteLink(link)).toBe(link);
	}
});

it("keeps the instance named after the code", () => {
	expect(
		normalizeInviteLink("https://fermi.chat/invite/abc123?instance=https%3A%2F%2Fspacebar.test"),
	).toBe("https://sbar.fyi/i/abc123?instance=spacebar.test");
});

it("reads the host case-insensitively and allows a port", () => {
	expect(normalizeInviteLink("https://FERMI.CHAT:8443/Invite/abc123")).toBe(
		"https://sbar.fyi/i/abc123",
	);
});
