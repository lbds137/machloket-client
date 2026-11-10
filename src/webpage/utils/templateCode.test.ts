import {describe, expect, it} from "vitest";
import {isValidTemplateCode} from "./templateCode";

describe("isValidTemplateCode", () => {
	it("accepts a code of letters, digits, _ and -", () => {
		expect(isValidTemplateCode("abc123_-XYZ")).toBe(true);
	});

	it("accepts a discord: code once", () => {
		expect(isValidTemplateCode("discord:abc123")).toBe(true);
		expect(isValidTemplateCode("discord:discord:abc123")).toBe(false);
		expect(isValidTemplateCode("discord:")).toBe(false);
	});

	it("refuses a code that climbs out of /guilds/templates/", () => {
		expect(isValidTemplateCode("../../users/@me")).toBe(false);
		expect(isValidTemplateCode("..%2F..%2Fusers%2F%40me")).toBe(false);
		expect(isValidTemplateCode("a/b")).toBe(false);
		expect(isValidTemplateCode("a?b=c")).toBe(false);
		expect(isValidTemplateCode("a#b")).toBe(false);
	});

	it("refuses nothing at all", () => {
		expect(isValidTemplateCode("")).toBe(false);
		expect(isValidTemplateCode(null)).toBe(false);
		expect(isValidTemplateCode(undefined)).toBe(false);
	});

	it("accepts 128 characters and refuses 129", () => {
		expect(isValidTemplateCode("a".repeat(128))).toBe(true);
		expect(isValidTemplateCode("a".repeat(129))).toBe(false);
	});
});
