import {describe, expect, it, vi} from "vitest";
import {restoreFailedSend} from "./composerRestore";

/** A composer with the pieces a restore touches, and spies on the ones it may call. */
function setup() {
	const typebox = Object.assign(document.createElement("div"), {
		markdown: {txt: "", boxupdate: vi.fn()},
	}) as unknown as Parameters<typeof restoreFailedSend>[0]["composer"]["typebox"];
	const pasteImageElement = document.createElement("div");
	const file = new Blob(["x"]);
	const thumb = document.createElement("img");
	const imagesHtml = new WeakMap<Blob, HTMLElement>([[file, thumb]]);
	let images: Blob[] = [];
	const getImages = () => images;
	const setImages = vi.fn((list: Blob[]) => {
		images = list;
	});
	const channel = () => {
		const c = {
			replyingto: null,
			textSave: "",
			files: [] as Blob[],
			makereplybox: vi.fn(),
			setDraft: vi.fn((content: string) => {
				c.textSave = content;
			}),
		};
		return c as unknown as Parameters<typeof restoreFailedSend>[0]["channel"];
	};
	return {typebox, pasteImageElement, file, thumb, imagesHtml, getImages, setImages, channel};
}

describe("a refused send", () => {
	it("restores the whole composer when its channel is still open", () => {
		const s = setup();
		const sent = s.channel();
		const reply = {id: "r1"} as never;

		restoreFailedSend({
			channel: sent,
			focused: sent,
			content: "hello",
			attachments: [s.file],
			replyingTo: reply,
			composer: s,
		});

		expect(s.typebox.textContent).toBe("hello");
		expect(s.typebox.markdown.txt).toBe("hello");
		expect(s.setImages).toHaveBeenCalledWith([s.file]);
		expect(s.pasteImageElement.contains(s.thumb)).toBe(true);
		expect(sent.replyingto).toBe(reply);
		expect(sent.makereplybox).toHaveBeenCalled();
		expect(sent.setDraft).toHaveBeenCalledWith("hello");
	});

	it("only saves the draft when another channel is open now", () => {
		const s = setup();
		const sent = s.channel();
		const other = s.channel();
		other.replyingto = {id: "other-reply"} as never;
		s.typebox.textContent = "typing in the other channel";
		s.typebox.markdown.txt = "typing in the other channel";

		restoreFailedSend({
			channel: sent,
			focused: other,
			content: "hello",
			attachments: [s.file],
			replyingTo: {id: "r1"} as never,
			composer: s,
		});

		// The composer belongs to the channel in front of the user: it is left alone.
		expect(s.typebox.textContent).toBe("typing in the other channel");
		expect(s.typebox.markdown.txt).toBe("typing in the other channel");
		expect(s.setImages).not.toHaveBeenCalled();
		expect(s.pasteImageElement.contains(s.thumb)).toBe(false);
		expect(sent.makereplybox).not.toHaveBeenCalled();
		expect(sent.replyingto).toBeNull();
		expect(other.replyingto).toEqual({id: "other-reply"});
		// The refused text still survives, as the sent channel's draft.
		expect(sent.setDraft).toHaveBeenCalledWith("hello");
	});

	it("doesn't overwrite a draft the user wrote in the sent channel meanwhile", () => {
		const s = setup();
		const sent = s.channel();
		sent.textSave = "second thought";

		restoreFailedSend({
			channel: sent,
			focused: s.channel(),
			content: "hello",
			attachments: [],
			replyingTo: null,
			composer: s,
		});

		expect(sent.textSave).toBe("second thought");
	});

	it("leaves a composer alone that the user has typed in since, in the same channel", () => {
		const s = setup();
		const sent = s.channel();
		s.typebox.textContent = "a newer message";
		s.typebox.markdown.txt = "a newer message";

		restoreFailedSend({
			channel: sent,
			focused: sent,
			content: "hello",
			attachments: [s.file],
			replyingTo: {id: "r1"} as never,
			composer: s,
		});

		expect(s.typebox.textContent).toBe("a newer message");
		expect(s.setImages).not.toHaveBeenCalled();
		expect(s.pasteImageElement.contains(s.thumb)).toBe(false);
		expect(sent.makereplybox).not.toHaveBeenCalled();
		expect(sent.replyingto).toBeNull();
	});

	it("leaves a composer alone that holds new attachments, in the same channel", () => {
		const s = setup();
		const sent = s.channel();
		s.setImages([new Blob(["new"])]);
		s.setImages.mockClear();

		restoreFailedSend({
			channel: sent,
			focused: sent,
			content: "hello",
			attachments: [s.file],
			replyingTo: null,
			composer: s,
		});

		expect(s.typebox.textContent).toBe("");
		expect(s.setImages).not.toHaveBeenCalled();
		expect(sent.makereplybox).not.toHaveBeenCalled();
	});
});
