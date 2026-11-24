import {afterEach, describe, expect, it, onTestFinished, vi} from "vitest";
import {captureRequests} from "./test/setup";

// Owner ruling 11-10 (TASK-18): invites are this client's own links, and nothing in the app
// sends a viewer to, fetches from, or trusts the upstream short-link host.

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {MarkDown} = await import("./markdown");
const {holdsInviteLink, inviteUrl, showNewInvite} = await import("./utils/inviteLink");

const API = "http://ownlinks.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.removeItem("trustedDomains");
	localStorage.removeItem("trustedDomainsShortLinkDropped");
});

describe("an invite link", () => {
	it("is this client's /invite page, naming the instance", () => {
		expect(inviteUrl("abc123", "https://spacebar.test/")).toBe(
			location.origin + "/invite/abc123?instance=https%3A%2F%2Fspacebar.test%2F",
		);
	});

	it("is what a new invite shows, and what Copy recognises", async () => {
		captureRequests(API + "/channels/c1/invites", () => Response.json({code: "abc123"}));
		const link = document.createElement("span");

		await showNewInvite(
			API + "/channels/c1/invites",
			{},
			{max_age: 0, max_uses: 0},
			"https://spacebar.test/",
			link,
		);

		expect(link.textContent).toBe(inviteUrl("abc123", "https://spacebar.test/"));
		expect(holdsInviteLink(link)).toBe(true);
	});

	it("isn't recognised when the box holds the reason there's none", () => {
		const link = document.createElement("span");
		link.textContent = "Invites disabled for channel";
		expect(holdsInviteLink(link)).toBe(false);
	});
});

describe("a sender's invite link from another client", () => {
	it("renders as the sender wrote it, pointing where they pointed it", () => {
		const written = "https://fermi.chat/invite/abc123?instance=spacebar.test";
		// Trusted, so the anchor carries its target (an untrusted host's link has no href and
		// asks before it opens). The trusted list is read once, at module load.
		const trusted = MarkDown.trustedDomains;
		MarkDown.trustedDomains = new Set([...trusted, "fermi.chat"]);
		onTestFinished(() => {
			MarkDown.trustedDomains = trusted;
		});
		const html = new MarkDown(written, undefined).makeHTML();
		const a = html.querySelector("a")!;

		expect(html.textContent).toBe(written);
		expect(a.href).toBe(written);
	});
});

describe("trusted link hosts", () => {
	it("default to this client's own host only", () => {
		expect([...MarkDown.getTrusted()]).toEqual([location.host]);
	});

	it("drop the old short-link wildcard from a stored list, keeping the user's own picks", () => {
		localStorage.setItem(
			"trustedDomains",
			JSON.stringify([location.host, "*.sbar.fyi", "example.com"]),
		);
		expect([...MarkDown.getTrusted()]).toEqual([location.host, "example.com"]);
	});

	// The drop is a one-time migration of the old default: an entry the user adds by hand later
	// is their choice, and stays.
	it.each([
		["after the drop ran on a stored list", [location.host, "*.sbar.fyi"]],
		["on a browser that had only the defaults", null],
	])("keep the wildcard when the user adds it themselves %s", (_when, stored) => {
		if (stored) localStorage.setItem("trustedDomains", JSON.stringify(stored));
		MarkDown.getTrusted();

		const trusted = MarkDown.trustedDomains;
		onTestFinished(() => {
			MarkDown.trustedDomains = trusted;
		});
		MarkDown.trustedDomains = new Set([location.host, "*.sbar.fyi"]);
		MarkDown.saveTrusted(true);

		expect([...MarkDown.getTrusted()]).toEqual([location.host, "*.sbar.fyi"]);
	});
});

describe("the app's source", () => {
	// Every non-test module, read as text: a reference to the upstream short-link host in any
	// of them is a fetch, a link or a trust entry this ruling removed.
	// @ts-expect-error import.meta.glob is Vite's; its vite/client types aren't loaded here
	const sources = import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./test/**"], {
		query: "?raw",
		import: "default",
		eager: true,
	}) as Record<string, string>;

	it("is read in full (positive control: this module set includes markdown.ts)", () => {
		expect(Object.keys(sources)).toContain("./markdown.ts");
		expect(Object.keys(sources).length).toBeGreaterThan(50);
	});

	// The one allowed mention, in markdown.ts: getTrusted drops the old default from a stored
	// list by name.
	const STORED_LIST_DROP = 'const OLD_SHORT_LINK_DEFAULT = "*.sbar.fyi";';

	it("never names the upstream short-link host", () => {
		const hits = Object.entries(sources)
			.filter(([path, text]) =>
				/sbar\.fyi/i.test(path === "./markdown.ts" ? text.replace(STORED_LIST_DROP, "") : text),
			)
			.map(([path]) => path);
		expect(hits).toEqual([]);
	});

	it("still drops the old wildcard from stored lists (the allowed mention is live)", () => {
		expect(sources["./markdown.ts"]).toContain(STORED_LIST_DROP);
	});
});
