import {afterEach, expect, it, vi} from "vitest";
import {previewURL} from "./previewURL";

afterEach(() => {
	vi.restoreAllMocks();
});

it("each new pick revokes the previous preview's URL, and a clear revokes the last", () => {
	const revoked = vi.spyOn(URL, "revokeObjectURL");
	const preview = previewURL();

	const first = preview(new Blob(["a"]));
	expect(revoked).not.toHaveBeenCalled();
	const second = preview(new Blob(["b"]));
	expect(revoked.mock.calls).toEqual([[first]]);
	expect(preview(null)).toBeUndefined();
	expect(revoked.mock.calls).toEqual([[first], [second]]);
});
