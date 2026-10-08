import {describe, expect, it} from "vitest";
import {addInstance} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as instancePicker.test.ts.
await import("./localuser");
const {getapiurls, getStringURLMap, indexInstances, instancefetch} = await import("./utils/utils");

const ORIGIN = "http://typed.test";

/** Settles `p`, or answers "timeout" after `ms`: a hang is the failure these tests are about. */
function within<T>(p: Promise<T>, ms = 2000) {
	return Promise.race([p, new Promise<"timeout">((res) => setTimeout(() => res("timeout"), ms))]);
}

describe("instance list", () => {
	it("a typed instance URL resolves even when the list gave no name shortcuts", async () => {
		await instancefetch;
		addInstance(ORIGIN);
		const names = getStringURLMap();
		const saved = new Map(names);
		names.clear();
		try {
			const result = await within(getapiurls(ORIGIN));

			expect(result).not.toBe("timeout");
			expect(result).toMatchObject({api: ORIGIN + "/api/v9"});
		} finally {
			saved.forEach((v, k) => names.set(k, v));
		}
	});

	it("indexes each listed name to its URL once the list loads, without the picker", async () => {
		await instancefetch;

		expect(getStringURLMap().get("spacebar")).toBe("https://spacebar.test");
	});

	it("one entry with an unusable icon drops that icon, not the whole list", () => {
		const list = indexInstances([
			{name: "Broken icon", icon: "http://", url: "https://broken.test"},
			{name: "Fine", url: "https://fine.test"},
		]);

		expect(list.map((i) => i.url)).toEqual(["https://broken.test", "https://fine.test"]);
		expect(list[0].image).toBeUndefined();
	});
});
