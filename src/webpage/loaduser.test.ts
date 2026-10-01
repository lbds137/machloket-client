import {describe, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
await import("./localuser");
const {Localuser} = await import("./localuser.js");

function mountLoadingDom() {
	for (const id of ["username", "status", "loading"]) {
		document.getElementById(id)?.remove();
		const el = document.createElement("span");
		el.id = id;
		document.body.append(el);
	}
	document.getElementById("userpfp")?.remove();
	const pfp = document.createElement("img");
	pfp.id = "userpfp";
	document.body.append(pfp);
	const loading = document.getElementById("loading")!;
	loading.classList.add("loading");
}

describe("loaduser", () => {
	it("dismisses the loading overlay (the reconnect retry path re-shows it)", () => {
		mountLoadingDom();
		const instance = Object.assign(Object.create(Localuser.prototype), {
			// `status` itself is accessor-only on the prototype (get reads user.status, set calls
			// user.setstatus) — so the stub carries it on the user, not the instance.
			user: {username: "probe", getpfpsrc: () => "x", status: "1", setstatus: () => {}},
		});
		instance.loaduser();

		const loading = document.getElementById("loading")!;
		expect(loading.classList.contains("doneloading")).toBe(true);
		expect(loading.classList.contains("loading")).toBe(false);
	});
});
