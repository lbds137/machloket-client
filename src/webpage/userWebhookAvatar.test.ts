import {describe, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {User} = await import("./user");

type UserJson = ConstructorParameters<typeof User>[0];
type Owner = ConstructorParameters<typeof User>[1];

// A webhook message carries its own avatar (Discord: per-message avatar_url). History loads
// webhook messages of one name with different avatars; each must keep its own.
describe("webhook authors with one name and different avatars", () => {
	it("stay separate users, each with its own avatar, whichever loads last", () => {
		const owner = {userMap: new Map(), guilds: []} as unknown as Owner;
		const webhook = {id: "w1", name: "Rick"} as UserJson["webhook"];
		const json = (avatar: string | null) =>
			({id: "w1", username: "Rick", avatar, webhook}) as unknown as UserJson;

		const withAvatar = new User(json("hash1"), owner);
		const without = new User(json(null), owner);

		expect(withAvatar).not.toBe(without);
		expect(withAvatar.avatar).toBe("hash1");
		expect(without.avatar).toBeNull();
	});

	it("keep their avatars when the avatar-less one loads first", () => {
		const owner = {userMap: new Map(), guilds: []} as unknown as Owner;
		const webhook = {id: "w1", name: "Rick"} as UserJson["webhook"];
		const json = (avatar: string | null) =>
			({id: "w1", username: "Rick", avatar, webhook}) as unknown as UserJson;

		const without = new User(json(null), owner);
		const withAvatar = new User(json("hash1"), owner);

		expect(without).not.toBe(withAvatar);
		expect(without.avatar).toBeNull();
		expect(withAvatar.avatar).toBe("hash1");
	});

	it("stay apart when the name and avatar would join into the same text", () => {
		const owner = {userMap: new Map(), guilds: []} as unknown as Owner;
		const webhook = {id: "w1", name: "A"} as UserJson["webhook"];
		const json = (username: string, avatar: string | null) =>
			({id: "w1", username, avatar, webhook}) as unknown as UserJson;

		const first = new User(json("A:::B", null), owner);
		const second = new User(json("A", "B:::"), owner);

		expect(first).not.toBe(second);
		expect(first.username).toBe("A:::B");
		expect(second.avatar).toBe("B:::");
	});

	it("still share one user when name and avatar match", () => {
		const owner = {userMap: new Map(), guilds: []} as unknown as Owner;
		const webhook = {id: "w1", name: "Rick"} as UserJson["webhook"];
		const json = () =>
			({id: "w1", username: "Rick", avatar: "hash1", webhook}) as unknown as UserJson;

		expect(new User(json(), owner)).toBe(new User(json(), owner));
	});
});
