import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {User} = await import("./user");

afterEach(() => {
	vi.restoreAllMocks();
});

function userWithBadges(badge_ids: string[]) {
	return Object.assign(Object.create(User.prototype), {
		id: "u2",
		public_flags: 0,
		badge_ids,
		owner: {info: {api: "http://badge.test/api/v9"}, headers: {}, badges: new Map()},
	}) as InstanceType<typeof User>;
}

const badge = (id: string) => ({id, description: id, icon: "icon"});

it("one profile fetch serves every unknown badge on the popup", async () => {
	const fetch = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async () => Response.json({badges: [badge("a"), badge("b")]}));
	const user = userWithBadges(["a", "b"]);

	expect((await user.getBadges()).map((b) => b.id)).toEqual(["a", "b"]);
	expect(fetch).toHaveBeenCalledTimes(1);
});

it("a badge the profile doesn't list isn't refetched on every popup open", async () => {
	const fetch = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async () => Response.json({badges: [badge("a")]}));
	const user = userWithBadges(["a", "gone"]);

	await user.getBadges();
	await user.getBadges();

	expect(fetch).toHaveBeenCalledTimes(1);
});

it("a refused profile shows no badges instead of throwing, and the next open retries", async () => {
	const fetch = vi
		.spyOn(globalThis, "fetch")
		.mockImplementationOnce(async () =>
			Response.json({message: "Unknown User", code: 10013}, {status: 404}),
		)
		.mockImplementation(async () => Response.json({badges: [badge("a")]}));
	const user = userWithBadges(["a"]);

	expect(await user.getBadges()).toEqual([]);
	expect((await user.getBadges()).map((b) => b.id)).toEqual(["a"]);
	expect(fetch).toHaveBeenCalledTimes(2);
});

// A regression pin (passes before the fix, which refetched every time): the cached profile
// load must not hide badges added later.
it("a USER_UPDATE with new badge ids loads them", async () => {
	const fetch = vi
		.spyOn(globalThis, "fetch")
		.mockImplementationOnce(async () => Response.json({badges: [badge("a")]}))
		.mockImplementation(async () => Response.json({badges: [badge("a"), badge("new")]}));
	const user = userWithBadges(["a"]);
	await user.getBadges();

	user.userupdate({badge_ids: ["a", "new"]} as never);

	expect((await user.getBadges()).map((b) => b.id)).toEqual(["a", "new"]);
	expect(fetch).toHaveBeenCalledTimes(2);
});

it("an update repeating the same badge ids (every message's author) doesn't refetch", async () => {
	const fetch = vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async () => Response.json({badges: [badge("a")]}));
	const user = userWithBadges(["a", "gone"]);
	await user.getBadges();

	user.userupdate({badge_ids: ["a", "gone"]} as never);
	await user.getBadges();

	expect(fetch).toHaveBeenCalledTimes(1);
});

it("a failed load doesn't cancel a newer one started after new badge ids", async () => {
	let failFirst!: () => void;
	const fetch = vi
		.spyOn(globalThis, "fetch")
		.mockImplementationOnce(
			() =>
				new Promise<Response>((res) => (failFirst = () => res(new Response(null, {status: 500})))),
		)
		.mockImplementation(async () => Response.json({badges: [badge("a"), badge("new")]}));
	const user = userWithBadges(["a"]);
	const first = user.getBadges();
	await new Promise((r) => setTimeout(r, 0));

	user.userupdate({badge_ids: ["a", "new", "gone"]} as never);
	const second = user.getBadges();
	failFirst();
	await Promise.all([first, second]);
	await user.getBadges();

	expect(fetch).toHaveBeenCalledTimes(2);
});
