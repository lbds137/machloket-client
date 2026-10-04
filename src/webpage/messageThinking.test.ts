import {describe, expect, it} from "vitest";
await import("./localuser");
const {Message} = await import("./message");
const {messageIn} = await import("./test/interactionFixture");

/** A stub message like the fixture's, with the render-relevant collections filled. */
function loadingMessage(flags: number, content: string) {
	const {channel} = messageIn("@me");
	// generateMessage reads this.localuser.user.id; the fixture's localuser stub has no user.
	(channel.localuser as {user: unknown}).user = {id: "me"};
	const message = Object.assign(Object.create(Message.prototype), {
		id: "500",
		flags,
		author: {id: "300", username: "TzurotBot"},
		owner: channel,
		headers: {},
		content: {makeHTML: () => {
			const d = document.createElement("div");
			d.textContent = content;
			return d;
		}, rawString: content, textContent: content, onUpdate: () => {}},
		reactions: [],
		embeds: [],
		attachments: [],
		stickers: [],
		edited_timestamp: null,
	}) as unknown as InstanceType<typeof Message>;
	return message;
}

describe("deferred (loading) messages", () => {
	it("a LOADING-flagged message renders a thinking indicator naming the author", () => {
		const message = loadingMessage(1 << 7, "");
		const div = document.createElement("div");
		message.generateMessage(undefined, false, div);

		expect(div.classList.contains("thinking")).toBe(true);
		expect(div.textContent).toContain("TzurotBot");
		expect(div.textContent).toContain("thinking");
	});

	it("a message without the LOADING flag renders no thinking indicator", () => {
		const message = loadingMessage(0, "real content");
		const div = document.createElement("div");
		message.generateMessage(undefined, false, div);

		expect(div.classList.contains("thinking")).toBe(false);
	});

	it("re-rendering after the defer clears drops the thinking class", () => {
		// The live bug: the defer renders with .thinking, the bot's real content arrives via
		// MESSAGE_UPDATE, and a re-render that kept the class left the whole reply italic.
		const message = loadingMessage(1 << 7, "");
		const div = document.createElement("div");
		message.generateMessage(undefined, false, div);
		expect(div.classList.contains("thinking")).toBe(true);

		message.flags = 0;
		message.generateMessage(undefined, false, div);

		expect(div.classList.contains("thinking")).toBe(false);
	});

	it("re-rendering a still-deferred bubble shows its label once", () => {
		// Neighbours regenerate whenever a message arrives, so a defer re-renders while loading.
		const message = loadingMessage(1 << 7, "");
		const div = document.createElement("div");
		message.generateMessage(undefined, false, div);
		message.generateMessage(undefined, false, div);

		expect(div.querySelectorAll("span")).toHaveLength(1);
	});
});
