import {describe, expect, it} from "vitest";
import {instanceLabel} from "./instanceLabel";

const names = new Map([["spacebar", "https://spacebar.chat"]]);

describe("instanceLabel", () => {
	it("an http(s) address shows as its host alone, port included", () => {
		expect(instanceLabel("https://chat.example.org/some/path?x=1", names)).toBe("chat.example.org");
		expect(instanceLabel("http://10.0.0.5:3001", names)).toBe("10.0.0.5:3001");
	});

	it("credentials in the address never show", () => {
		expect(instanceLabel("https://Your account is locked@evil.example", names)).toBe(
			"evil.example",
		);
	});

	it("a listed instance's name shows as its address's host, whatever its case", () => {
		expect(instanceLabel("Spacebar", names)).toBe("spacebar.chat");
		expect(instanceLabel("SPACEBAR", names)).toBe("spacebar.chat");
	});

	it("anything else is undefined: no text of the link's own reaches the page", () => {
		for (const value of [
			"Your account is locked. Call 555-0100",
			"chat.example.org",
			"data:text/plain,Your account is locked",
			"javascript:alert(1)",
			"ftp://files.example.org",
			"",
		]) {
			expect(instanceLabel(value, names), value).toBeUndefined();
		}
	});
});
