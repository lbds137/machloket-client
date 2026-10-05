import {describe, expect, it} from "vitest";
import {bumpCommandRecency, getCommandRecency, recentFirst} from "./commandRecency";

describe("recentFirst", () => {
	it("used commands come first, most recent on top", () => {
		const out = recentFirst([{name: "a"}, {name: "b"}, {name: "c"}], {c: 100, a: 200});
		expect(out.map((_) => _.name)).toEqual(["a", "c", "b"]);
	});

	it("never-used commands follow, alphabetical", () => {
		const out = recentFirst([{name: "zeta"}, {name: "alpha"}, {name: "mid"}], {});
		expect(out.map((_) => _.name)).toEqual(["alpha", "mid", "zeta"]);
	});

	it("equal recency timestamps fall back to alphabetical", () => {
		const out = recentFirst([{name: "b"}, {name: "a"}], {b: 5, a: 5});
		expect(out.map((_) => _.name)).toEqual(["a", "b"]);
	});
});

describe("stored command recency", () => {
	for (const stored of ["null", "[]", '"text"', "{not json"]) {
		it(`reads ${stored} as no recency, and a use still records`, () => {
			const saved = localStorage.getItem("commandRecency");
			try {
				localStorage.setItem("commandRecency", stored);
				expect(getCommandRecency()).toEqual({});

				bumpCommandRecency("300/ask");
				expect(Object.keys(getCommandRecency())).toEqual(["300/ask"]);
			} finally {
				if (saved === null) localStorage.removeItem("commandRecency");
				else localStorage.setItem("commandRecency", saved);
			}
		});
	}
});
