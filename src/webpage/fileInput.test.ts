import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Dialog} = await import("./settings");

const URL_ = "http://file.test/profile";

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll("dialog, .PopUp").forEach((e) => e.remove());
});

function avatarForm() {
	const form = new Dialog("").options.addForm("", () => {}, {fetchURL: URL_, method: "PATCH"});
	const avatar = form.addImageInput("Avatar", "avatar", {clear: true});
	form.addTextInput("Name", "username", {initText: "nyx"});
	return {form, avatar};
}

const emptyFiles = () => new DataTransfer().files;
const settled = (p: Promise<unknown>) =>
	Promise.race([p.then(() => "settled"), new Promise((r) => setTimeout(() => r("pending"), 300))]);

it("a picker closed without a file leaves the image unchanged instead of breaking the save", async () => {
	const sent = captureRequests(URL_, () => Response.json({}));
	const {form, avatar} = avatarForm();
	avatar.value = emptyFiles();

	await form.submit();

	expect(sent).toEqual([{username: "nyx"}]);
});

it("a file that can't be read says so, and the form can be sent again", async () => {
	const sent = captureRequests(URL_, () => Response.json({}));
	vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
		setTimeout(() => this.dispatchEvent(new ProgressEvent("error")));
	});
	const {form, avatar} = avatarForm();
	const dt = new DataTransfer();
	dt.items.add(new File(["x"], "a.png", {type: "image/png"}));
	avatar.value = dt.files;
	const formError = vi.fn();
	form.onFormError = formError;

	expect(await settled(form.submit())).toBe("settled");
	expect(sent).toEqual([]);
	expect(formError).toHaveBeenCalledTimes(1);
	expect(form.subbmitting).toBe(false);
});

const picked = (name: string) => {
	const dt = new DataTransfer();
	dt.items.add(new File(["x"], name, {type: "image/png"}));
	return dt.files;
};

it("the image preview ignores a change with no file", () => {
	// A listener's throw never leaves dispatchEvent, so watch the read itself.
	const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
	const {avatar} = avatarForm();

	avatar.input.deref()!.dispatchEvent(new Event("change"));

	expect(read).not.toHaveBeenCalled();
});

it("a picker closed without a file keeps the earlier pick", async () => {
	const sent = captureRequests(URL_, () => Response.json({}));
	const {form, avatar} = avatarForm();
	const input = avatar.input.deref()!;
	input.files = picked("a.png");
	input.dispatchEvent(new Event("input"));
	// Chrome empties the list when the reopened picker is cancelled.
	input.files = new DataTransfer().files;
	input.dispatchEvent(new Event("input"));

	await form.submit();

	expect(sent).toEqual([
		{avatar: expect.stringMatching(/^data:image\/png;base64,/), username: "nyx"},
	]);
});

it("Clear empties the picker, so picking the same file again counts", () => {
	const options = new Dialog("").options;
	const fi = options.addFileInput("Banner", () => {}, {clear: true});
	const html = fi.generateHTML();
	const input = html.querySelector("input")!;
	input.files = picked("b.png");

	(html.querySelector("button") as HTMLButtonElement).click();

	expect(input.files.length).toBe(0);
});

it("a cleared file input submits nothing, not the file picked before", () => {
	const onSubmit = vi.fn();
	const options = new Dialog("").options;
	const fi = options.addFileInput("Banner", onSubmit, {clear: true});
	const html = fi.generateHTML();
	const input = html.querySelector("input")!;
	const dt = new DataTransfer();
	dt.items.add(new File(["x"], "b.png", {type: "image/png"}));
	input.files = dt.files;
	fi.onChange();

	(html.querySelector("button") as HTMLButtonElement).click();
	fi.submit();

	expect(onSubmit).toHaveBeenCalledWith(null);
});
