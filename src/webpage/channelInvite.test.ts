import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://invite.test/api/v9";

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

/** Channel c1's Invite dialog, as its context menu opens it. */
async function openInvite() {
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		name: "general",
		headers: {},
		owner: {
			id: "g1",
			properties: {name: "Home"},
			info: {api: API, wellknown: "http://invite.test"},
		},
	}) as InstanceType<typeof Channel>;
	channel.createInvite();
	const link = document.querySelector(".invitediv .ellipsis")!;
	await expect.poll(() => link.textContent).not.toBe("");
	return link;
}

it("a refused invite says why instead of showing a dead link", async () => {
	captureRequests(API + "/channels/c1/invites", () =>
		Response.json({code: 50013, message: "Missing Permissions"}, {status: 403}),
	);

	const link = await openInvite();

	expect(link.textContent).toBe("Missing Permissions");
});

it("an invite that never reached the server says so", async () => {
	captureRequests(API + "/channels/c1/invites", () =>
		Promise.reject(new TypeError("Failed to fetch")),
	);

	const link = await openInvite();

	expect(link.textContent).toBe(I18n.requestFailed("offline"));
});

// Discord's "temporary" membership kicks the joiner when they go offline; a use limit isn't that.
it("an invite with a use limit doesn't grant temporary membership", async () => {
	const sent = captureRequests(API + "/channels/c1/invites", () => Response.json({code: "abc"}));
	const link = await openInvite();
	expect(link.textContent).toContain("/i/abc");

	const uses = document.querySelectorAll<HTMLSelectElement>(".dialogModal select")[1];
	uses.selectedIndex = 1; // a single use
	uses.dispatchEvent(new Event("change"));
	await expect.poll(() => sent.length).toBe(2);

	expect(sent[1]).toMatchObject({max_uses: 1, temporary: false});
});

it("an answer with no invite in it (an empty body) says the request failed", async () => {
	captureRequests(API + "/channels/c1/invites", () => Response.json(null));

	const link = await openInvite();

	expect(link.textContent).toBe(I18n.requestFailed("HTTP 200"));
});

it("the copy button copies only a link, not the reason there's none", async () => {
	captureRequests(API + "/channels/c1/invites", () =>
		Response.json({code: 50013, message: "Missing Permissions"}, {status: 403}),
	);
	const copied = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
	await openInvite();

	document.querySelector<HTMLElement>(".invitediv .copycontainer")!.click();

	expect(copied).not.toHaveBeenCalled();
});
