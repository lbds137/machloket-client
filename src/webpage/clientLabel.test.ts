import {describe, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
await import("./localuser");
const {getClientLabelFromNonce} = await import("./message.js");

function nonceFor(clientHead: string): string {
	return btoa(`${clientHead}|${Math.floor(Date.now() / 1000)}`);
}

describe("the client label decoded from a message nonce", () => {
	it("labels machloket- nonces as Machloket", () => {
		expect(getClientLabelFromNonce(nonceFor("machloket-abc1234"))).toBe("Machloket");
	});

	it("still labels fermo- nonces as Fermo (upstream users on shared instances)", () => {
		expect(getClientLabelFromNonce(nonceFor("fermo-abc1234"))).toBe("Fermo");
	});

	it("leaves unknown client heads unlabeled", () => {
		expect(getClientLabelFromNonce(nonceFor("somethingelse-abc"))).toBeUndefined();
	});
});
