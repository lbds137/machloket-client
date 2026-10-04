import {describe, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {User} = await import("./user");

describe("another user's avatar change", () => {
	it("re-points their rendered avatars at the NEW image", () => {
		const user = Object.assign(Object.create(User.prototype), {
			id: "u1",
			username: "alice",
			avatar: "old",
			owner: {},
			getpfpsrc(this: {avatar: string}) {
				return "https://cdn.test/avatars/u1/" + this.avatar + ".png";
			},
		}) as InstanceType<typeof User>;
		const pfp = Object.assign(document.createElement("img"), {
			srcs: "",
			setSrcs(this: {srcs: string}, src: string) {
				this.srcs = src;
			},
		});
		pfp.classList.add("userid:u1");
		document.body.append(pfp);
		try {
			user.userupdate({id: "u1", username: "alice", avatar: "new"} as Parameters<typeof user.userupdate>[0]);

			expect(pfp.srcs).toBe("https://cdn.test/avatars/u1/new.png");
		} finally {
			pfp.remove();
		}
	});
});
