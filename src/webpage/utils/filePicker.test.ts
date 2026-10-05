import {afterEach, expect, it, vi} from "vitest";
import {pickFiles} from "./filePicker";

afterEach(() => {
	vi.restoreAllMocks();
});

it("opens a multi-file picker that's ready for the pick when it opens", () => {
	let opened: HTMLInputElement | undefined;
	let readyAtOpen = false;
	vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
		this: HTMLInputElement,
	) {
		opened = this;
		readyAtOpen = this.multiple && this.onchange !== null;
	});
	const picked: File[][] = [];

	pickFiles((files) => picked.push(files));
	const files = new DataTransfer();
	files.items.add(new File(["a"], "a.png"));
	files.items.add(new File(["b"], "b.png"));
	opened!.files = files.files;
	opened!.dispatchEvent(new Event("change"));

	expect(readyAtOpen).toBe(true);
	expect(picked.map((f) => f.map((x) => x.name))).toEqual([["a.png", "b.png"]]);
});
