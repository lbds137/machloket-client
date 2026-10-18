import {afterEach, describe, expect, it, vi} from "vitest";
await import("./localuser");
const {Message} = await import("./message");
const {messageIn} = await import("./test/interactionFixture");

type TestMessage = InstanceType<typeof Message>;

/** A fixture message with its localuser's own user set (render paths read it). */
function message(fields: Record<string, unknown>) {
	const {channel} = messageIn("@me");
	(channel.localuser as {user: unknown}).user = {id: "me"};
	return Object.assign(Object.create(Message.prototype), {
		id: "500",
		flags: 0,
		author: {id: "300", username: "Someone"},
		owner: channel,
		headers: {},
		reactions: [],
		embeds: [],
		attachments: [],
		stickers: [],
		edited_timestamp: null,
		...fields,
	}) as unknown as TestMessage;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("reactionRemove", () => {
	const reacted = () =>
		message({
			reactions: [
				{emoji: {name: "👍"}, count: 3, me: false},
				{emoji: {name: "party", id: "11"}, count: 2, me: false},
				{emoji: {name: "party", id: "22"}, count: 2, me: false},
			],
		});

	it("re-renders when someone else's removal leaves the count above zero", () => {
		const m = reacted();
		const render = vi.spyOn(m, "updateReactions").mockImplementation(() => {});
		m.reactionRemove({name: "👍"}, "someone-else");
		expect(m.reactions[0].count).toBe(2);
		expect(render).toHaveBeenCalled();
	});

	it("matches a custom emoji by id, not by a shared name", () => {
		const m = reacted();
		vi.spyOn(m, "updateReactions").mockImplementation(() => {});
		m.reactionRemove({name: "party", id: "22"}, "someone-else");
		expect(m.reactions.map((r) => r.count)).toEqual([3, 2, 1]);
	});

	it("an add of a same-named custom emoji from another guild is its own reaction", () => {
		const m = reacted();
		vi.spyOn(m, "updateReactions").mockImplementation(() => {});
		m.reactionAdd({name: "party", id: "33"}, {id: "someone-else"});
		m.reactionAdd({name: "party", id: "22"}, {id: "someone-else"});
		expect(m.reactions.map((r) => r.count)).toEqual([3, 2, 3, 1]);
	});
});

describe("single-choice polls", () => {
	function pollMessage(
		answerCounts: {id: number; count: number; me_voted: boolean}[],
		allow_multiselect = false,
	) {
		let onPollUpdate: (() => void) | null = null;
		const m = message({
			content: {
				makeHTML: () => document.createElement("div"),
				rawString: "",
				textContent: "",
				onUpdate: () => {},
			},
			poll: {
				question: {text: "Q?"},
				answers: [
					{answer_id: 1, poll_media: {text: "yes"}},
					{answer_id: 2, poll_media: {text: "no"}},
				],
				expiry: new Date(Date.now() + 86_400_000).toISOString(),
				allow_multiselect,
				results: {is_finalized: false, answer_counts: answerCounts},
			},
		});
		Object.assign(m.localuser, {
			subToPollUpdate: (_id: string, fn: (() => void) | null) => {
				onPollUpdate = fn;
			},
		});
		const div = document.createElement("div");
		document.body.append(div);
		m.generateMessage(undefined, false, div);
		return {div, update: () => onPollUpdate?.()};
	}

	it("show the results after the user votes", () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, {status: 204}));
		const {div, update} = pollMessage([]);
		expect(div.querySelector(".countpollspan")).toBeNull();

		(div.querySelector(".answerArea") as HTMLElement).click();
		(div.querySelector(".pollBody button") as HTMLButtonElement).click();
		update(); // the server's vote echo re-renders the poll

		expect(div.querySelector(".countpollspan")).not.toBeNull();
		div.remove();
	});

	it("don't show the results for a pick that hasn't been submitted", () => {
		const {div, update} = pollMessage([]);
		(div.querySelector(".answerArea") as HTMLElement).click();
		update(); // someone else's vote re-renders the poll mid-pick
		expect(div.querySelector(".countpollspan")).toBeNull();
		div.remove();
	});

	it("show the results on load when the user has already voted", () => {
		const {div} = pollMessage([{id: 1, count: 1, me_voted: true}]);
		expect(div.querySelector(".countpollspan")).not.toBeNull();
		div.remove();
	});

	const refused = () => Response.json({code: 50013, message: "Missing Permissions"}, {status: 403});
	const checks = (div: HTMLElement) =>
		[...div.querySelectorAll<HTMLInputElement>(".answerArea input")].map((c) => c.checked);

	it("a refused vote goes back to the vote the server holds, and says why", async () => {
		const {I18n} = await import("./i18n");
		await I18n.done;
		vi.spyOn(globalThis, "fetch").mockResolvedValue(refused());
		const {div, update} = pollMessage([]);

		(div.querySelector(".answerArea") as HTMLElement).click();
		(div.querySelector(".pollBody button") as HTMLButtonElement).click();
		await vi.waitFor(() =>
			expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions")),
		);
		update(); // a poll update re-renders it from the same answers

		expect(checks(div)).toEqual([false, false]);
		expect(div.querySelector(".countpollspan")).toBeNull();
		div.remove();
		document.body.replaceChildren();
	});

	it("a refused multiple-choice tick is taken back", async () => {
		const {I18n} = await import("./i18n");
		await I18n.done;
		vi.spyOn(globalThis, "fetch").mockResolvedValue(refused());
		const {div} = pollMessage([{id: 2, count: 1, me_voted: true}], true);

		(div.querySelector(".answerArea") as HTMLElement).click();

		await vi.waitFor(() =>
			expect(document.body.textContent).toContain(I18n.requestFailed("Missing Permissions")),
		);
		expect(checks(div)).toEqual([false, true]);
		div.remove();
		document.body.replaceChildren();
	});

	it("a refusal for a vote a newer one has replaced changes nothing", async () => {
		let refuseFirst: () => void = () => {};
		vi.spyOn(globalThis, "fetch")
			.mockImplementationOnce(() => new Promise((r) => (refuseFirst = () => r(refused()))))
			.mockResolvedValueOnce(new Response(null, {status: 204}));
		const {div} = pollMessage([], true);
		const [yes, no] = div.querySelectorAll<HTMLElement>(".answerArea");

		yes.click();
		no.click();
		refuseFirst();
		await new Promise((r) => setTimeout(r, 50));

		expect(checks(div)).toEqual([true, true]);
		expect(document.body.textContent).not.toContain("Missing Permissions");
		div.remove();
	});
});
