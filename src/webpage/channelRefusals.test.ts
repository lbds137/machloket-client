import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {Dialog, Options} = await import("./settings");
const {I18n} = await import("./i18n");
const {Tag} = await import("./tag");
await I18n.done;

const API = "http://channel-refusals.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll("dialog, .PopUp, .background").forEach((e) => e.remove());
});

it("unmute refused rolls mute_config and showMuteState back and opens the dialog; accepted keeps the new config", async () => {
	const url = `${API}/users/@me/guilds/g1/settings`;
	const shown = vi.spyOn(Dialog.prototype, "show");
	const prevConfig = {selected_time_window: 1800, end_time: Date.now() + 1800_000};
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		headers: {},
		message_notifications: 1,
		mute_config: prevConfig,
		owner: {id: "g1", info: {api: API}, unreads: () => {}},
		unreads: () => {},
	}) as InstanceType<typeof Channel>;
	const showMuteState = vi.spyOn(channel as any, "showMuteState");

	captureRequests(url, () => new Response(null, {status: 403}));
	await channel.unmuteChannel();

	expect(channel.mute_config).toBe(prevConfig);
	expect(showMuteState).toHaveBeenCalledTimes(2);
	expect(shown).toHaveBeenCalledOnce();

	shown.mockClear();
	showMuteState.mockClear();
	captureRequests(url, () => new Response(null, {status: 204}));
	await channel.unmuteChannel();

	expect(channel.mute_config).toEqual({selected_time_window: -1, end_time: 0});
	expect(showMuteState).toHaveBeenCalledTimes(1);
	expect(shown).not.toHaveBeenCalled();
});

it("a refused unmute followed by a newer mute does not roll back", async () => {
	const url = `${API}/users/@me/guilds/g1/settings`;
	let answerUnmute!: (res: Response) => void;
	let calls = 0;
	captureRequests(url, () => {
		if (++calls === 1) {
			return new Promise<Response>((res) => {
				answerUnmute = res;
			});
		}
		return new Response(null, {status: 204});
	});
	const shown = vi.spyOn(Dialog.prototype, "show");
	const prevConfig = {selected_time_window: 3600, end_time: Date.now() + 3600_000};
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		headers: {},
		message_notifications: 1,
		mute_config: prevConfig,
		owner: {id: "g1", info: {api: API}, unreads: () => {}},
		unreads: () => {},
	}) as InstanceType<typeof Channel>;

	const unmuting = channel.unmuteChannel();
	await vi.waitFor(() => expect(answerUnmute).toBeDefined());

	const buttons = vi.spyOn(Options.prototype, "addButtonInput");
	channel.muteChannel();
	shown.mockClear();
	const muting = (buttons.mock.calls[0][2] as () => Promise<void>)();
	const mutedConfig = channel.mute_config;
	expect(mutedConfig?.selected_time_window).toBe(1800);

	answerUnmute(new Response(null, {status: 403}));
	await Promise.all([unmuting, muting]);

	expect(channel.mute_config).toBe(mutedConfig);
	expect(shown).not.toHaveBeenCalled();
});

it("deleteChannel returns false and opens the dialog when refused, and true without a dialog when accepted", async () => {
	const url = `${API}/channels/c1`;
	const shown = vi.spyOn(Dialog.prototype, "show");
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		headers: {},
		owner: {info: {api: API}},
	}) as InstanceType<typeof Channel>;

	captureRequests(url, () => new Response(null, {status: 403}));
	expect(await channel.deleteChannel()).toBe(false);
	expect(shown).toHaveBeenCalledOnce();

	shown.mockClear();
	captureRequests(url, () => new Response(null, {status: 200}));
	expect(await channel.deleteChannel()).toBe(true);
	expect(shown).not.toHaveBeenCalled();
});

it("leaving a thread opens the refusal dialog when refused", async () => {
	captureRequests(`${API}/channels/t1/thread-members/@me`, () => new Response(null, {status: 403}));
	const shown = vi.spyOn(Dialog.prototype, "show");
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "t1",
		type: 11,
		member: {},
		headers: {},
		owner: {info: {api: API}, localuser: {user: {id: "u1"}}},
		hasPermission: () => false,
	}) as InstanceType<typeof Channel>;

	const menu = document.createElement("div");
	for (const part of Channel.contextmenu.buttons) {
		part.makeContextHTML(channel, undefined, menu, [], new WeakSet());
	}
	const leaveButton = Array.from(menu.querySelectorAll("button")).find(
		(b) => b.textContent === I18n.threads.leave(),
	)!;
	leaveButton.click();

	await vi.waitFor(() => expect(shown).toHaveBeenCalledOnce());
});

it("a refused tag toggle in editTags rolls back selected and the sent list", async () => {
	let calls = 0;
	const sent = captureRequests(`${API}/channels/th1`, () =>
		++calls === 1 ? new Response(null, {status: 403}) : Response.json({}),
	);
	const shown = vi.spyOn(Dialog.prototype, "show");
	const parent = Object.create(Channel.prototype) as InstanceType<typeof Channel>;
	parent.availableTags = [
		new Tag({id: "t1", name: "Bug", moderated: false}, parent),
		new Tag({id: "t2", name: "Docs", moderated: false}, parent),
	];
	const thread = Object.assign(Object.create(Channel.prototype), {
		id: "th1",
		headers: {},
		appliedTags: ["t1"],
		parent,
		owner: {info: {api: API}},
		hasPermission: () => true,
	}) as InstanceType<typeof Channel>;

	thread.editTags();
	shown.mockClear();

	const tagElms = document.querySelectorAll<HTMLElement>(".forumTagSelect .forumTag");
	expect(tagElms).toHaveLength(2);
	expect(tagElms[0].classList.contains("selected")).toBe(true);
	expect(tagElms[1].classList.contains("selected")).toBe(false);

	// Click t2: optimistically selected, then rolled back when the 403 arrives.
	tagElms[1].click();
	expect(tagElms[1].classList.contains("selected")).toBe(true);
	await vi.waitFor(() => expect(shown).toHaveBeenCalledOnce());

	expect(tagElms[0].classList.contains("selected")).toBe(true);
	expect(tagElms[1].classList.contains("selected")).toBe(false);

	// Clicking t1 next sends [] (from rolled-back ["t1"]), not ["t2"] (from ["t1", "t2"]).
	tagElms[0].click();
	expect(sent).toEqual([{applied_tags: ["t1", "t2"]}, {applied_tags: []}]);
});

it("an unmute then a mute, both refused, end on what the server still holds", async () => {
	const answers: ((res: Response) => void)[] = [];
	captureRequests(`${API}/users/@me/guilds/g1/settings`, () => new Promise<Response>((r) => answers.push(r)));
	const original = {selected_time_window: 3600, end_time: Date.now() + 3600_000};
	const channel = Object.assign(Object.create(Channel.prototype), {
		id: "c1",
		headers: {},
		message_notifications: 1,
		mute_config: original,
		owner: {id: "g1", info: {api: API}, unreads: () => {}},
		unreads: () => {},
	}) as InstanceType<typeof Channel>;

	const unmuting = channel.unmuteChannel();
	const buttons = vi.spyOn(Options.prototype, "addButtonInput");
	channel.muteChannel();
	const muting = (buttons.mock.calls[0][2] as () => Promise<void>)();
	await vi.waitFor(() => expect(answers).toHaveLength(2));
	for (const answer of answers) answer(new Response(null, {status: 403}));
	await Promise.all([unmuting, muting]);

	expect(channel.mute_config).toBe(original);
});

it("two tag clicks, both refused, end on the tags the server still holds", async () => {
	const answers: ((res: Response) => void)[] = [];
	captureRequests(`${API}/channels/th1`, () => new Promise<Response>((r) => answers.push(r)));
	vi.spyOn(Dialog.prototype, "show");
	const parent = Object.create(Channel.prototype) as InstanceType<typeof Channel>;
	parent.availableTags = [
		new Tag({id: "t1", name: "Bug", moderated: false}, parent),
		new Tag({id: "t2", name: "Docs", moderated: false}, parent),
	];
	const thread = Object.assign(Object.create(Channel.prototype), {
		id: "th1",
		headers: {},
		appliedTags: ["t1"],
		parent,
		owner: {info: {api: API}},
		hasPermission: () => true,
	}) as InstanceType<typeof Channel>;
	thread.editTags();
	const tagElms = document.querySelectorAll<HTMLElement>(".forumTagSelect .forumTag");

	tagElms[1].click();
	tagElms[0].click();
	await vi.waitFor(() => expect(answers).toHaveLength(2));
	for (const answer of answers) answer(new Response(null, {status: 403}));

	await vi.waitFor(() => expect(tagElms[0].classList.contains("selected")).toBe(true));
	expect(tagElms[1].classList.contains("selected")).toBe(false);
});
