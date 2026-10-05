import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Direct} = await import("./direct");
const {User} = await import("./user");
const {I18n} = await import("./i18n");
await I18n.done;

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll("dialog, .PopUp").forEach((e) => e.remove());
});

it("a refused group DM says so instead of opening a channel that doesn't exist", async () => {
	vi.spyOn(User, "makeSelector").mockResolvedValue(new Set([{id: "u2"}]) as never);
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({message: "Too many recipients", code: 50035}, {status: 400}),
	);
	const goTo = vi.fn();
	const dms = Object.assign(Object.create(Direct.prototype), {
		headers: {},
		owner: {info: {api: "http://dm.test/api/v9"}, inrelation: new Set(), goToChannel: goTo},
	}) as InstanceType<typeof Direct>;

	await dms.makeGroup();

	expect(goTo).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain(I18n.requestFailed("HTTP 400"));
});
