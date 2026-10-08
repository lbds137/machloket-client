import {describe, expect, it} from "vitest";
import {bumpCommandRecency, getCommandRecency} from "./commandRecency";

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
