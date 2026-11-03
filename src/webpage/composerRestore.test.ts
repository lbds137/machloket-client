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
	const images: Blob[] = [];
	const getImages = () => images;
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
	return {typebox, pasteImageElement, file, thumb, imagesHtml, getImages, channel};
}

describe("a refused send", () => {
	it("restores the whole composer when its channel is still open", () => {
		const s = setup();
		const sent = s.channel();
		const reply = {id: "r1"} as never;

		const putBack = restoreFailedSend({
			channel: sent,
			focused: sent,
			content: "hello",
			attachments: [s.file],
			replyingTo: reply,
			composer: s,
		});

		expect(putBack).toBe(true);
		expect(s.typebox.textContent).toBe("hello");
		expect(s.typebox.markdown.txt).toBe("hello");
		expect(s.getImages()).toEqual([s.file]);
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

		const putBack = restoreFailedSend({
			channel: sent,
			focused: other,
			content: "hello",
			attachments: [],
			replyingTo: {id: "r1"} as never,
			composer: s,
		});

		expect(putBack).toBe(true);
		// The composer belongs to the channel in front of the user: it is left alone.
		expect(s.typebox.textContent).toBe("typing in the other channel");
		expect(s.typebox.markdown.txt).toBe("typing in the other channel");
		expect(s.getImages()).toEqual([]);
		expect(s.pasteImageElement.childElementCount).toBe(0);
		expect(sent.makereplybox).not.toHaveBeenCalled();
		expect(sent.replyingto).toBeNull();
		expect(other.replyingto).toEqual({id: "other-reply"});
		// The refused text still survives, as the sent channel's draft.
		expect(sent.setDraft).toHaveBeenCalledWith("hello");
	});

	it("sets no draft when another channel is open and the send had attachments", () => {
		const s = setup();
		const sent = s.channel();
		const other = s.channel();

		const putBack = restoreFailedSend({
			channel: sent,
			focused: other,
			content: "hello",
			attachments: [s.file],
			replyingTo: null,
			composer: s,
		});

		expect(putBack).toBe(false);
		expect(sent.setDraft).not.toHaveBeenCalled();
		expect(sent.textSave).toBe("");
		expect(s.getImages()).toEqual([]);
		expect(s.pasteImageElement.contains(s.thumb)).toBe(false);
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
		expect(s.getImages()).toEqual([]);
		expect(s.pasteImageElement.contains(s.thumb)).toBe(false);
		expect(sent.makereplybox).not.toHaveBeenCalled();
		expect(sent.replyingto).toBeNull();
	});

	it("leaves a composer alone that holds new attachments, in the same channel", () => {
		const s = setup();
		const sent = s.channel();
		const attachedSince = new Blob(["new"]);
		s.getImages().push(attachedSince);

		restoreFailedSend({
			channel: sent,
			focused: sent,
			content: "hello",
			attachments: [s.file],
			replyingTo: null,
			composer: s,
		});

		expect(s.typebox.textContent).toBe("");
		expect(s.getImages()).toEqual([attachedSince]);
		expect(sent.makereplybox).not.toHaveBeenCalled();
	});

	it.each([
		["one of them", true],
		["none of them", false],
	])(
		"puts nothing back when %s has a thumbnail to show, so the failed message keeps the files",
		(_, withShown) => {
			const s = setup();
			const sent = s.channel();
			const unshown = new Blob(["no thumbnail"]);

			const putBack = restoreFailedSend({
				channel: sent,
				focused: sent,
				content: "hello",
				attachments: withShown ? [s.file, unshown] : [unshown],
				replyingTo: {id: "r1"} as never,
				composer: s,
			});

			// A file in the list sends, so one the strip can't show would send unseen.
			expect(putBack).toBe(false);
			expect(s.getImages()).toEqual([]);
			expect(s.pasteImageElement.childElementCount).toBe(0);
			expect(s.typebox.textContent).toBe("");
			expect(s.typebox.markdown.txt).toBe("");
			expect(sent.replyingto).toBeNull();
			expect(sent.makereplybox).not.toHaveBeenCalled();
			expect(sent.setDraft).not.toHaveBeenCalled();
		},
	);

	it("says whether it put the message back, so the caller knows to keep the failed one", () => {
		const restore = (
			prepare: (
				s: ReturnType<typeof setup>,
				sent: ReturnType<ReturnType<typeof setup>["channel"]>,
			) => boolean,
		) => {
			const s = setup();
			const sent = s.channel();
			const sameChannel = prepare(s, sent);
			return restoreFailedSend({
				channel: sent,
				focused: sameChannel ? sent : s.channel(),
				content: "hello",
				attachments: [],
				replyingTo: null,
				composer: s,
			});
		};

		expect(restore(() => true)).toBe(true);
		expect(restore(() => false)).toBe(true);
		expect(
			restore((_, sent) => {
				sent.textSave = "second thought";
				return false;
			}),
		).toBe(false);
		expect(
			restore((s) => {
				s.typebox.textContent = "a newer message";
				return true;
			}),
		).toBe(false);
	});
});
