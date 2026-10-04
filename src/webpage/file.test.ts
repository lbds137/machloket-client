import {describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {File} = await import("./file");

it("draws a file card's icon as an SVG, not a character phones lack", () => {
	// "🗎" (U+1F5CE) isn't in Android's emoji font: the phone showed "?".
	const file = new File(
		{
			id: "1",
			filename: "notes.pdf",
			content_type: "application/pdf",
			size: 2048,
			url: "http://cdn.test/notes.pdf",
		} as never,
		null,
	);

	const card = file.createunknown();

	const icon = card.querySelector(".fileicon")!;
	expect(icon.textContent).toBe("");
	expect(icon.querySelector(".svgicon.svg-file")).not.toBeNull();
});

describe("an attachment's images", () => {
	const hex = (ms: number) => Math.round(ms).toString(16);
	function attachments(owner: object) {
		const json = (id: string, filename: string, content_type: string) =>
			({id, filename, content_type, size: 1, url: `http://cdn.test/attachments/1/${id}/${filename}?ex=${hex(Date.now() + 3600e3)}`}) as never;
		const list = [
			new File(json("1", "clip.mp4", "video/mp4"), owner as never),
			new File(json("2", "a.png", "image/png"), owner as never),
			new File(json("3", "notes.pdf", "application/pdf"), owner as never),
			new File(json("4", "b.png", "image/png"), owner as never),
		];
		Object.assign(owner, {attachments: list});
		return list;
	}
	const owner = () => ({info: {cdn: "http://cdn.test"}, localuser: {refreshURL: async (u: string) => u}});

	it("open a viewer that steps through the images only", async () => {
		const {ImagesDisplay} = await import("./disimg");
		let shown: {files: unknown[]; index: number} | undefined;
		const show = vi.spyOn(ImagesDisplay.prototype, "show").mockImplementation(function (this: never) {
			shown = this;
		});
		try {
			const files = attachments(owner());
			(files[3].getHTML().querySelector("img") as HTMLImageElement).click();
			expect(shown?.files).toEqual([files[1], files[3]]);
			expect(shown?.index).toBe(1);
		} finally {
			show.mockRestore();
		}
	});

	it("re-sign a CDN link that expires within seconds or already has", () => {
		const file = attachments(owner())[1];
		const at = (ms: number) => `http://cdn.test/attachments/1/2/a.png?ex=${hex(ms)}`;
		expect(file.refreshURL(at(Date.now() + 3600e3))).toBeUndefined();
		expect(file.refreshURL(at(Date.now() + 2000))).toBeInstanceOf(Promise);
		expect(file.refreshURL(at(Date.now() - 2000))).toBeInstanceOf(Promise);
	});
});

it("the account's own link refresh uses the same expiry margin", async () => {
	const {Localuser} = await import("./localuser");
	const hex = (ms: number) => Math.round(ms).toString(16);
	const refreshURL = vi.fn(async (u: string) => u + "&fresh");
	const self = {info: {cdn: "http://cdn.test"}, refreshURL};
	const at = (ms: number) => `http://cdn.test/attachments/1/2/a.png?ex=${hex(ms)}`;
	const fresh = at(Date.now() + 3600e3);
	expect(await Localuser.prototype.refreshIfNeeded.call(self, fresh)).toBe(fresh);
	expect(await Localuser.prototype.refreshIfNeeded.call(self, at(Date.now() - 2000))).toContain("&fresh");
});

it("leaves a non-web attachment url off the file card's link", async () => {
	// Attachment urls come from the instance; a javascript: one would run on click.
	const file = new File(
		{
			id: "2",
			filename: "evil.txt",
			content_type: "text/plain",
			size: 1,
			url: "javascript:alert(1)",
		} as never,
		null,
	);

	const card = file.createunknown(Promise.resolve("javascript:alert(2)"));
	await Promise.resolve();

	const link = card.querySelector("a")!;
	expect(link.getAttribute("href")).toBeNull();
});

it("keeps web and local-preview (blob:) attachment links", () => {
	for (const url of ["https://cdn.test/a.txt", "blob:http://localhost/abc"]) {
		const card = new File(
			{id: "3", filename: "a.txt", content_type: "text/plain", size: 1, url} as never,
			null,
		).createunknown();
		expect(card.querySelector("a")!.getAttribute("href")).toBe(url);
	}
});
