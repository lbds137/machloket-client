import type {Channel} from "./channel.js";
import type {Message} from "./message.js";
import type {MarkDown} from "./markdown.js";

/** The composer pieces a refused send puts back. */
export type ComposerParts = {
	typebox: HTMLElement & {markdown: MarkDown};
	pasteImageElement: HTMLElement;
	/** The thumbnails of the files in the strip, by file. */
	imagesHtml: WeakMap<Blob, HTMLElement>;
	/** The composer's attached-files list, itself: it's the channel's list and its thumbnails'. */
	getImages: () => Blob[];
};

/** Whether a channel that isn't open can keep refused text as its draft: not over a draft or saved
 * files of its own, which would send with it. */
export function draftIsFree(channel: Channel): boolean {
	return !channel.textSave && !channel.files.length;
}

/** Puts a refused send back where the user can resend it. `focused` is the channel open in
 * the composer right now.
 * - Another channel is open: the composer belongs to that channel and is left alone; the
 *   refused text only survives as the sent channel's draft when the send had no attachments
 *   that a draft can't carry and that channel has no draft or saved files of its own by now
 *   (otherwise returns false so the refused message stays in the channel as failed, with
 *   retry or delete).
 * - The same channel, the composer still empty: the text, files and reply target come back,
 *   unless a file has no thumbnail to show it by (returns false; the failed message keeps it).
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
		// Not when the send had attachments a draft can't carry, or over a draft written since.
		if (!attachments.length && draftIsFree(channel)) {
			channel.setDraft(content);
			return true;
		}
		return false;
	}
	const {typebox, pasteImageElement, imagesHtml, getImages} = composer;
	if (typebox.textContent || getImages().length) return false;
	// A safety net, not an expected path: every writer of the list also sets its thumbnail. But
	// every file in the list sends, so one the strip can't show would send unseen: the failed
	// message keeps them all instead.
	const thumbnails = attachments
		.map((file) => imagesHtml.get(file))
		.filter((img): img is HTMLElement => !!img);
	if (thumbnails.length !== attachments.length) return false;
	getImages().push(...attachments);
	pasteImageElement.append(...thumbnails);
	channel.replyingto = replyingTo;
	channel.makereplybox();
	typebox.textContent = content;
	typebox.markdown.txt = content;
	typebox.markdown.boxupdate(Infinity);
	channel.setDraft(content);
	return true;
}
