import type {Channel} from "./channel.js";
import type {Message} from "./message.js";
import type {MarkDown} from "./markdown.js";

/** The composer pieces a refused send puts back. */
export type ComposerParts = {
	typebox: HTMLElement & {markdown: MarkDown};
	pasteImageElement: HTMLElement;
	/** The thumbnails of the files in the strip, by file. */
	imagesHtml: WeakMap<Blob, HTMLElement>;
	/** The composer's attached-files list as it is now. */
	getImages: () => Blob[];
	/** Replaces the composer's attached-files list. */
	setImages: (images: Blob[]) => void;
};

/** Puts a refused send back where the user can resend it. `focused` is the channel open in
 * the composer right now.
 * - Another channel is open: the composer belongs to that channel and is left alone; the
 *   refused text only survives as the sent channel's draft, and only when that channel has
 *   no draft or saved files of its own by now.
 * - The same channel, the composer still empty: the text, files and reply target come back.
 * - The same channel, but the user has typed or attached since: the composer is left alone
 *   on purpose. Restoring would overwrite the new text, and the caller keeps the refused
 *   message in the channel as failed (retry or delete) whenever this returns false. */
export function restoreFailedSend(args: {
	channel: Channel;
	focused: Channel | undefined;
	content: string;
	attachments: Blob[];
	replyingTo: Message | null;
	composer: ComposerParts;
}): boolean {
	const {channel, focused, content, attachments, replyingTo, composer} = args;
	if (focused !== channel) {
		// Not over a draft the user wrote in that channel since the send.
		if (!channel.textSave && !channel.files.length) {
			channel.setDraft(content);
			return true;
		}
		return false;
	}
	const {typebox, pasteImageElement, imagesHtml, getImages, setImages} = composer;
	if (typebox.textContent || getImages().length) return false;
	setImages(attachments);
	for (const file of attachments) {
		const img = imagesHtml.get(file);
		if (!img) continue;
		pasteImageElement.append(img);
	}
	channel.replyingto = replyingTo;
	channel.makereplybox();
	typebox.textContent = content;
	typebox.markdown.txt = content;
	typebox.markdown.boxupdate(Infinity);
	channel.setDraft(content);
	return true;
}
