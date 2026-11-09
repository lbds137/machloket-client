import {afterEach, expect, it, vi} from "vitest";
import {trySetItem} from "./trySetItem.js";

afterEach(() => {
	vi.restoreAllMocks();
});

it("reports a write the store refuses instead of throwing it", () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
	});
	expect(trySetItem("trySetItem-test", "x")).toBe(false);
});

it("lets an error that isn't the store's refusal through", () => {
	// A bug in the caller (a TypeError) logged and swallowed here would hide behind "storage full".
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw new TypeError("not the store");
	});
	expect(() => trySetItem("trySetItem-test", "x")).toThrow(TypeError);
});
