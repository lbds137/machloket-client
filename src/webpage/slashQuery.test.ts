import {describe, expect, it} from "vitest";
import {slashCommandQuery} from "./slashQuery";

describe("slash-command query", () => {
	it("a long word followed by punctuation answers at once instead of freezing the tab", () => {
		const draft = "/" + "a".repeat(26) + ",";

		const start = performance.now();
		const query = slashCommandQuery(draft);
		const elapsed = performance.now() - start;

		expect(query).toBeUndefined();
		expect(elapsed).toBeLessThan(50);
	});

	it.each([
		["/", ""],
		["/ban", "ban"],
		["/ban user", "ban user"],
		["/  ban   user_2", "  ban   user_2"],
		["/ban\tuser\nnow", "ban\tuser\nnow"],
	])("%j queries %j", (draft, query) => {
		expect(slashCommandQuery(draft)).toBe(query);
	});

	it.each(["ban", "/ ", "/ban ", "/ban,", "/ban user!", "x/ban"])("%j is not a command query", (draft) => {
		expect(slashCommandQuery(draft)).toBeUndefined();
	});
});
