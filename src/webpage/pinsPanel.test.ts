import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "https://pins.test/api/v9";

/** Just enough of a channel for the pins panel, which fetches `${api}/channels/${id}/pins`. */
function fakeChannel() {
	return Object.assign(Object.create(Channel.prototype), {
		id: "42",
		owner: {info: {api: API}, headers: {}},
		messages: new Map(),
		headers: {},
	});
}

const panel = () => document.querySelector(".pinnedMessages") as HTMLElement;
const settle = () => new Promise((res) => setTimeout(res, 0));

afterEach(() => {
	document.querySelectorAll(".pinnedMessages").forEach((el) => el.remove());
	vi.restoreAllMocks();
});

// The instance can take seconds to answer (5 s measured from the owner's phone); an empty box
// meanwhile looked broken.
it("says it's loading while the pins request is in flight", async () => {
	vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
	void fakeChannel().pinnedClick(new DOMRect(0, 0, 10, 10));
	await settle();

	expect(panel().textContent).toBe(I18n.pinsLoading());
});

it("says so when the pins can't be loaded, and loads them on the next open", async () => {
	const fetchMock = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValueOnce(new Response("nope", {status: 500}))
		.mockResolvedValueOnce(Response.json([]));
	const channel = fakeChannel();

	await channel.pinnedClick(new DOMRect(0, 0, 10, 10));
	expect(panel().textContent).toBe(I18n.pinsLoadFailed());

	panel().remove();
	await channel.pinnedClick(new DOMRect(0, 0, 10, 10));
	expect(fetchMock).toHaveBeenCalledTimes(2);
	expect(panel().textContent).toBe(I18n.noPins());
});
