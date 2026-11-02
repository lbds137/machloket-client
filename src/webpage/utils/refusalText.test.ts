import {describe, expect, it} from "vitest";

await import("../localuser");
const {errorPaths, formErrors, rejectedProperty, serverReason} = await import("./refusalText");

// The two shapes of an invalid form's `errors`: flat dotted keys, and the same paths as a tree.
const node = (message: string) => ({_errors: [{code: "X", message}]});
const paths = (errors: unknown) => errorPaths(errors).map(([path]) => path);

describe("errorPaths reads both shapes alike", () => {
	it("a field at the top", () => {
		expect(paths({content: node("a")})).toEqual(["content"]);
	});

	it("a dotted key and its tree", () => {
		expect(paths({"data.content": node("a")})).toEqual(["data.content"]);
		expect(paths({data: {content: node("a")}})).toEqual(["data.content"]);
	});

	it("array indexes as string keys", () => {
		expect(paths({components: {"0": {type: node("a")}}})).toEqual(["components.0.type"]);
	});

	it("a root failure: the flat empty key and the tree's own _errors", () => {
		expect(paths({"": node("a")})).toEqual([""]);
		expect(paths(node("a"))).toEqual([""]);
	});

	it("a node with errors of its own and below it", () => {
		expect(paths({components: {...node("a"), "0": {type: node("b")}}})).toEqual([
			"components",
			"components.0.type",
		]);
	});

	it("nothing to read", () => {
		for (const nothing of [undefined, null, "x", {}]) expect(paths(nothing)).toEqual([]);
	});

	it("an _errors that isn't a list isn't a node", () => {
		for (const bad of ["x", 1, true, {}]) expect(paths({a: {_errors: bad}})).toEqual([]);
	});

	it("a body nested past any real form doesn't throw", () => {
		let deep: unknown = node("a");
		for (let i = 0; i < 200_000; i++) deep = {a: deep};
		expect(paths(deep)).toEqual([]);
		expect(formErrors(deep)).toEqual([]);
	});
});

describe("the server's reason", () => {
	it("is found at any depth", () => {
		const body = {code: 50035, message: "Invalid Form Body", errors: {a: {"0": {b: node("deep")}}}};
		expect(formErrors(body.errors)).toEqual(["deep"]);
		expect(serverReason(body)).toBe("deep");
	});

	it("is found on a tree's root", () => {
		expect(serverReason({code: 50035, message: "Invalid Form Body", errors: node("root")})).toBe("root");
	});
});

describe("rejectedProperty", () => {
	const named = {_errors: [{params: {additionalProperty: "nope"}}]};

	it("names the field wherever the validator put it", () => {
		expect(rejectedProperty({"": named})).toBe("nope");
		expect(rejectedProperty(named)).toBe("nope");
		expect(rejectedProperty({data: {"0": named}})).toBe("nope");
	});

	it("is undefined when none is named", () => {
		expect(rejectedProperty({a: node("x")})).toBeUndefined();
		expect(rejectedProperty(undefined)).toBeUndefined();
	});
});
