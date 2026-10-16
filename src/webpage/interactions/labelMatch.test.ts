import {describe, expect, it} from "vitest";
import {tokenMatchRatio} from "./labelMatch";
import {similarLabel} from "./commandPicker";

describe("tokenMatchRatio", () => {
	it("matches tokens as in-order subsequence over words and wires to similarLabel", () => {
		expect(tokenMatchRatio("/character browse", "char browse")).toBeGreaterThan(0);
		expect(tokenMatchRatio("/character browse", "char browse")).toBeLessThan(
			similarLabel("/character browse", "CHARACTER BROWSE"),
		);
		expect(tokenMatchRatio("/character browse", "browse char")).toBe(0);
		expect(tokenMatchRatio("/character browse", "cha act")).toBe(0);
		expect(tokenMatchRatio("/character browse", "ter brow")).toBeGreaterThan(0);
		expect(tokenMatchRatio("/character browse", "CHAR BROWSE")).toBeGreaterThan(0);
		expect(tokenMatchRatio("/character browse", "zzz qq")).toBe(0);
		expect(tokenMatchRatio("/character browse", "")).toBe(0);
		const wired = similarLabel("/character browse", "char browse");
		expect(wired).toBe(tokenMatchRatio("/character browse", "char browse"));
	});
	it("edges: trim, repeated tokens, whitespace-only search, empty label", () => {
		expect(tokenMatchRatio("/character browse", "  char browse  ")).toBeGreaterThan(0);
		expect(tokenMatchRatio("/character browse", "browse browse")).toBe(0);
		expect(tokenMatchRatio("/character browse", "   ")).toBe(0);
		expect(tokenMatchRatio("", "char")).toBe(0);
	});
});
