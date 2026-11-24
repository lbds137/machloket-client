import {describe, expect, it} from "vitest";
import {DEFAULT_SOURCE_REPO, sourceUrl} from "./sourceOffer";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("the source link for this build", () => {
	it("is this repository at the build's commit when nothing is configured", () => {
		expect(sourceUrl(undefined, SHA)).toBe(`${DEFAULT_SOURCE_REPO}/tree/${SHA}`);
		expect(sourceUrl("  ", SHA)).toBe(`${DEFAULT_SOURCE_REPO}/tree/${SHA}`);
	});

	it("uses a deployment's own repository, trailing slash or not", () => {
		expect(sourceUrl("https://git.example.test/me/fork/", "v1.2.0")).toBe(
			"https://git.example.test/me/fork/tree/v1.2.0",
		);
	});

	it("links the repository itself when the build has no revision", () => {
		expect(sourceUrl(undefined, "dev")).toBe(DEFAULT_SOURCE_REPO);
		expect(sourceUrl("https://git.example.test/me/fork", "")).toBe(
			"https://git.example.test/me/fork",
		);
	});

	it("keeps a revision with a slash inside one path segment", () => {
		expect(sourceUrl(undefined, "release/1")).toBe(`${DEFAULT_SOURCE_REPO}/tree/release%2F1`);
	});

	// The link is rendered as a Markdown link: a setting that isn't a web URL, or that would
	// break out of the link syntax, fails the build instead of shipping a broken offer.
	it.each([
		["not a URL", "github.com/me/fork"],
		["not a web link", "javascript:alert(1)"],
		["a bracket or parenthesis", "https://git.example.test/me/(fork)"],
		["whitespace", "https://git.example.test/me/my fork"],
	])("refuses a setting that is %s", (_why, repo) => {
		expect(() => sourceUrl(repo, SHA)).toThrow(/MACHLOKET_SOURCE_URL/);
	});
});
