import {expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");

/** A session that knows friends f1 and f2 (from READY's relationships). */
function sessionWithFriends() {
	const f1 = {id: "f1", setstatus: vi.fn()};
	const f2 = {id: "f2", setstatus: vi.fn()};
	const user = Object.assign(Object.create(Localuser.prototype), {
		presences: new Map(),
		guilds: [],
		generateFavicon: () => {},
		userMap: new Map([
			["f1", f1],
			["f2", f2],
		]),
	});
	return {user, f1, f2};
}

it("READY_SUPPLEMENTAL's friend presences show who's online right away", async () => {
	const {user, f1, f2} = sessionWithFriends();

	await user.handleEvent({
		op: 0,
		t: "READY_SUPPLEMENTAL",
		d: {
			guilds: [],
			merged_presences: {
				guilds: [],
				// The server sends the user object; Discord sends user_id. Both are friends here.
				friends: [
					{user: {id: "f1"}, status: "online", activities: [], client_status: {}},
					{user_id: "f2", status: "dnd", activities: [], client_status: {}},
				],
			},
		},
	});

	expect(f1.setstatus).toHaveBeenCalledWith("online");
	expect(f2.setstatus).toHaveBeenCalledWith("dnd");
	expect(user.presences.get("f1")).toMatchObject({status: "online"});
	expect(user.presences.get("f2")).toMatchObject({status: "dnd"});
});
