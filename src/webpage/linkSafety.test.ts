import {afterEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {newTotpSecret} = await import("./localuser");
const {MarkDown} = await import("./markdown");
const {youtubeEmbedSrc} = await import("./embed");
const {badgeIdsFromFlags} = await import("./user");
const {attachmentUrl, externalUrl, postLoginRedirect} = await import("./utils/netUtils");

// Links that run script in the client's origin when navigated to or opened.
const scripted = [
	"javascript:alert(1)",
	"JaVaScRiPt:alert(1)",
	"java\tscript:alert(1)",
	" javascript:alert(1)",
	"data:text/html,<b>x</b>",
	"vbscript:x",
];

describe("externalUrl: only web and mail links leave the app", () => {
	it.each(scripted)("refuses %s", (url) => {
		expect(externalUrl(url)).toBeNull();
	});
	it.each(["https://example.com/a?b=c", "http://example.com/", "mailto:someone@example.com"])(
		"accepts %s",
		(url) => {
			expect(externalUrl(url)?.href).toBe(new URL(url).href);
		},
	);
	it("refuses what doesn't parse", () => {
		expect(externalUrl("not a url")).toBeNull();
	});
});

describe("MarkDown.safeLink", () => {
	afterEach(() => {
		MarkDown.trustedDomains.delete("");
	});

	it.each(scripted)("leaves a %s link inert (no href, no click handler)", (url) => {
		const a = document.createElement("a");
		MarkDown.safeLink(a, url);
		expect(a.getAttribute("href")).toBeNull();
		expect(a.onmouseup).toBeNull();
		const div = document.createElement("div");
		MarkDown.safeLink(div, url);
		expect(div.onmouseup).toBeNull();
	});

	it("still wires a web link (positive control)", () => {
		const div = document.createElement("div");
		MarkDown.safeLink(div, "https://example.com/");
		expect(div.onmouseup).not.toBeNull();
	});

	it("never trusts an empty host, even one already saved by an older build", () => {
		MarkDown.trustedDomains.add("");
		expect(MarkDown.isTrustedHost("")).toBe(false);
	});
});

describe("youtubeEmbedSrc", () => {
	it("refuses a javascript: url whose parsed host is youtube.com", () => {
		const url = "javascript://youtube.com/%0Aalert(1)//";
		expect(new URL(url).host).toBe("youtube.com");
		expect(youtubeEmbedSrc(url)).toBeNull();
	});
	it("refuses plain http and other hosts", () => {
		expect(youtubeEmbedSrc("http://youtube.com/embed/abc")).toBeNull();
		expect(youtubeEmbedSrc("https://evil.example/embed/abc")).toBeNull();
		expect(youtubeEmbedSrc("not a url")).toBeNull();
	});
	it("plays a YouTube embed url", () => {
		expect(youtubeEmbedSrc("https://youtube.com/embed/abc")).toBe(
			"https://youtube.com/embed/abc?autoplay=1",
		);
	});
});

describe("postLoginRedirect: ?goback= stays on this origin", () => {
	it.each(["//evil.example/phish", "/\\evil.example", "https://evil.example/", "javascript:alert(1)"])(
		"refuses %s",
		(redir) => {
			expect(postLoginRedirect(redir)).toBe("/channels/@me");
		},
	);
	it("defaults when there is no goback", () => {
		expect(postLoginRedirect(null)).toBe("/channels/@me");
	});
	it("follows a same-origin path or URL", () => {
		expect(postLoginRedirect("/channels/1/2")).toBe(location.origin + "/channels/1/2");
		expect(postLoginRedirect(location.origin + "/invite/abc")).toBe(
			location.origin + "/invite/abc",
		);
	});
});

describe("badgeIdsFromFlags", () => {
	it("reads the known bits", () => {
		expect(badgeIdsFromFlags(0)).toEqual([]);
		expect(badgeIdsFromFlags(1 | (1 << 3))).toEqual(["staff", "hypesquad"]);
	});
	it("terminates on the sign bit and negative values, ignoring unknown bits", () => {
		expect(badgeIdsFromFlags(2 ** 31)).toEqual([]);
		expect(badgeIdsFromFlags(2 ** 40 + 1)).toEqual(["staff"]);
		expect(badgeIdsFromFlags(-1)).toHaveLength(27);
		expect(badgeIdsFromFlags(-1)).not.toContain(undefined);
	});
});

describe("newTotpSecret", () => {
	it("draws from the platform CSPRNG, not Math.random", () => {
		const csprng = vi.spyOn(crypto, "getRandomValues");
		const weak = vi.spyOn(Math, "random");
		const secret = newTotpSecret();
		expect(csprng).toHaveBeenCalled();
		expect(weak).not.toHaveBeenCalled();
		expect(secret).toMatch(/^[A-Z2-7]{32}$/);
		csprng.mockRestore();
		weak.mockRestore();
	});
});

describe("attachmentUrl", () => {
	it.each(scripted)("refuses %s", (url) => {
		expect(attachmentUrl(url)).toBeNull();
	});
	it("keeps web and blob: links", () => {
		for (const url of ["https://cdn.test/a", "http://cdn.test/a", "blob:http://localhost/x"]) {
			expect(attachmentUrl(url)).toBe(url);
		}
	});
});
