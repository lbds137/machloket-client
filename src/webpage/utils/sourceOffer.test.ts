import {describe, expect, it} from "vitest";
import {creditLine, DEFAULT_SOURCE_REPO, sourceUrl} from "./sourceOffer";

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

	it("keeps a revision's parentheses from ending the link where it is pasted", () => {
		expect(sourceUrl(undefined, "v1(rc)")).toBe(`${DEFAULT_SOURCE_REPO}/tree/v1%28rc%29`);
	});

	it.each([".", ".."])("links the repository itself for a revision of %s", (rev) => {
		expect(sourceUrl(undefined, rev)).toBe(DEFAULT_SOURCE_REPO);
	});

	// A setting that isn't a plain web address, or that would end the link early where it is
	// pasted, fails the build instead of shipping a broken offer.
	it.each([
		["not a URL", "github.com/me/fork"],
		["not a web link", "javascript:alert(1)"],
		["a bracket or parenthesis", "https://git.example.test/me/(fork)"],
		["whitespace", "https://git.example.test/me/my fork"],
		["a query", "https://git.example.test/me/fork?tab=code"],
		["a fragment", "https://git.example.test/me/fork#readme"],
	])("refuses a setting that is %s", (_why, repo) => {
		expect(() => sourceUrl(repo, SHA)).toThrow(/MACHLOKET_SOURCE_URL/);
	});
});

describe("the credit line", () => {
	const URL_ = `${DEFAULT_SOURCE_REPO}/tree/${SHA}`;

	it("puts the link where the translation says", () => {
		const p = creditLine((l) => `Source: ${l}. Thanks.`, URL_);
		expect(p.textContent).toBe(`Source: ${URL_}. Thanks.`);
		expect(p.querySelector("a")?.getAttribute("href")).toBe(URL_);
	});

	it("keeps the text after a repeated placeholder", () => {
		const p = creditLine((l) => `Source: ${l} (${l}). Based on Fermo.`, URL_);
		expect(p.textContent).toBe(`Source: ${URL_} (${URL_}). Based on Fermo.`);
		expect(p.querySelectorAll("a")).toHaveLength(1);
	});

	it("still offers the link, apart from the text, when a translation drops the placeholder", () => {
		const p = creditLine(() => "Source for this build.", URL_);
		expect(p.textContent).toBe(`Source for this build. ${URL_}`);
		expect(p.querySelector("a")?.getAttribute("href")).toBe(URL_);
	});
});
