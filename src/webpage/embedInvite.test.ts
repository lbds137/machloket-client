import {expect, it, onTestFinished, vi} from "vitest";
import {addInstance, captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Embed} = await import("./embed");

const ORIGIN = "http://embedinv.test";
const API = ORIGIN + "/api/v9";

/**
 * Draws the preview for a link to the viewer's own instance (it loads at once, no tap needed)
 * with the invite GET answering `respond`, and waits for that GET.
 */
async function renderInvite(respond: () => Response | Promise<Response>) {
	addInstance(ORIGIN);
	const asked = captureRequests(API + "/invites/abc", respond);
	const localuser = {info: {api: API, wellknown: ORIGIN}, guildids: new Map(), headers: {}};
	const embed = new Embed(
		{type: "invite", url: ORIGIN + "/invite/abc", invite: {url: ORIGIN, code: "abc"}} as never,
		{channel: {guild: {localuser}}} as never,
	);
	const html = embed.generateHTML();
	document.body.append(html);
	onTestFinished(() => html.remove());
	await vi.waitFor(() => expect(asked).toHaveLength(1));
	return html;
}

/** The preview gave way to the plain link embed (what a refused invite already gets). */
function expectLinkFallback(html: HTMLElement) {
	return vi.waitFor(() => {
		expect(html.querySelector(".linkembed")).not.toBeNull();
		expect(html.classList.contains("inviteEmbed")).toBe(false);
	});
}

it("a refused invite preview falls back to the plain link (the control)", async () => {
	const html = await renderInvite(() => Response.json({message: "Unknown Invite"}, {status: 404}));

	await expectLinkFallback(html);
});

it("an invite preview GET that never arrived falls back to the plain link", async () => {
	const html = await renderInvite(() => Promise.reject(new TypeError("offline")));

	await expectLinkFallback(html);
});

it("a valid invite still renders the preview (the control)", async () => {
	const html = await renderInvite(() =>
		Response.json({
			code: "abc",
			channel: {id: "c1", name: "general", type: 0},
			guild: {id: "g1", name: "Wonderland", icon: null},
		}),
	);

	// The gate could reject a good invite and every fallback test would still pass.
	// generateInvite returns the embed element itself: the class sits on `html`.
	await vi.waitFor(() => expect(html.classList.contains("inviteEmbed")).toBe(true));
	expect(html.querySelector(".linkembed")).toBeNull();
});

it("an invite preview answer that isn't JSON falls back to the plain link", async () => {
	const html = await renderInvite(() => new Response("<html>"));

	await expectLinkFallback(html);
});

it("an invite preview answer without a guild falls back to the plain link", async () => {
	const html = await renderInvite(() => Response.json({message: "odd"}));

	await expectLinkFallback(html);
});
