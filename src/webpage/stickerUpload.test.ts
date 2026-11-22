import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Guild} = await import("./guild");
const {Options} = await import("./settings");
const {I18n} = await import("./i18n");
await I18n.done;

const API = "http://stickerupload.test/api/v9";

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

/** A guild whose member may manage expressions, with the fields its settings builder reads. */
function guild() {
	const owner = Object.assign(Object.create(Localuser.prototype), {
		info: {api: API, cdn: "", wellknown: "http://stickerupload.test"},
		headers: {Authorization: "t"},
		userinfo: {localuserStore: {guilds: {}, channels: {}, user: {}}},
		userMap: new Map(),
		guilds: [],
	}) as InstanceType<typeof Localuser>;
	const g = Object.assign(Object.create(Guild.prototype), {
		id: "g1",
		headers: {Authorization: "t"},
		channels: [],
		headchannels: [],
		emojis: [],
		stickers: [],
		properties: {name: "G", features: []},
		member: {hasPermission: (perm: string) => perm === "MANAGE_GUILD_EXPRESSIONS"},
		owner,
	}) as unknown as InstanceType<typeof Guild>;
	// The real constructor seeds this; Channel's constructor reads it.
	g.perminfo = {channels: {}};
	return g;
}

/** Records what each named Options builder method returned, keeping the real method working. */
function record<
	K extends "addButtonInput" | "addForm" | "addFileInput" | "addTextInput" | "addEmojiInput",
>(method: K) {
	const real = Options.prototype[method] as (...args: unknown[]) => unknown;
	const calls: {args: unknown[]; result: unknown}[] = [];
	vi.spyOn(Options.prototype, method).mockImplementation(function (
		this: InstanceType<typeof Options>,
		...args: unknown[]
	) {
		const result = real.apply(this, args);
		calls.push({args, result});
		return result;
	} as never);
	return calls;
}

it("the sticker upload POST is sent untimed (an image upload must not die at the API budget)", async () => {
	const buttons = record("addButtonInput");
	const forms = record("addForm");
	const files = record("addFileInput");
	const texts = record("addTextInput");
	const emojis = record("addEmojiInput");
	const sent = captureRequests(API + "/guilds/g1/stickers", () => Response.json({id: "s1"}));
	const fetchSpy = vi.spyOn(globalThis, "fetch");

	guild().generateSettings();
	const upload = buttons.find((c) => c.args[1] === I18n.sticker.upload());
	expect(upload).not.toBeUndefined();
	(upload!.args[2] as () => void)();

	const form = forms.at(-1)!.result as {submit(): Promise<unknown>};
	const transfer = new DataTransfer();
	transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], "s.png", {type: "image/png"}));
	(files.at(-1)!.result as {value: FileList}).value = transfer.files;
	(texts.at(-1)!.result as {value: string}).value = "wave";
	(emojis.at(-1)!.result as {value: unknown}).value = {id: "e1"};
	await form.submit();

	expect(sent).toHaveLength(1);
	const call = fetchSpy.mock.calls.find(([url]) => String(url) === API + "/guilds/g1/stickers");
	expect(call?.[1]?.method).toBe("POST");
	expect(call?.[1]?.signal).toBeUndefined();
});
