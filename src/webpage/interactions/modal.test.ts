import {beforeEach, describe, expect, it, vi} from "vitest";
import {captureRequests} from "../test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first), so load that before the modal.
const {Localuser} = await import("../localuser");
const {InteractionModal} = await import("./modal");
const {I18n} = await import("../i18n");
await I18n.done;

const API = "http://modal.test/api/v9";

/** A modal like Tzurot's toolkit builds: every field in a Label, prose as a bare TextDisplay. */
function sampleModal() {
	return {
		id: "1100",
		nonce: "42",
		channel_id: "200",
		custom_id: "persona-edit",
		title: "Edit persona",
		application: {id: "300", name: "Tzurot", icon: null},
		components: [
			{type: 10, content: "Changes apply to **new** messages."},
			{
				type: 18,
				label: "Name",
				description: "Shown above replies",
				component: {
					type: 4,
					custom_id: "name",
					style: 1,
					min_length: 2,
					max_length: 32,
					value: "Alice",
				},
			},
			{
				type: 18,
				label: "Backstory",
				component: {
					type: 4,
					custom_id: "story",
					style: 2,
					required: false,
					placeholder: "Optional",
				},
			},
			{
				type: 18,
				label: "Model",
				component: {
					type: 3,
					custom_id: "model",
					options: [
						{label: "Small", value: "s"},
						{label: "Large", value: "l", default: true},
					],
				},
			},
			{
				type: 18,
				label: "Tone",
				component: {
					type: 21,
					custom_id: "tone",
					options: [
						{label: "Warm", value: "warm"},
						{label: "Dry", value: "dry"},
					],
				},
			},
			{
				type: 18,
				label: "Features",
				component: {
					type: 22,
					custom_id: "features",
					required: false,
					options: [
						{label: "Voice", value: "voice"},
						{label: "Images", value: "images", default: true},
					],
				},
			},
			{type: 18, label: "Public", component: {type: 23, custom_id: "public"}},
		],
	};
}

function host(openerMessageId?: string) {
	return {
		api: API,
		headers: {"Content-type": "application/json", Authorization: "token"},
		sessionId: "session-1",
		guildId: "400",
		openerMessageId,
	};
}

let root: HTMLElement;
const q = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;
const field = (customId: string) => q<HTMLElement>(`[data-custom-id="${customId}"]`);

beforeEach(() => {
	document
		.querySelectorAll(".interactionModal")
		.forEach((modal) => modal.closest(".background")?.remove());
});

describe("InteractionModal", () => {
	it("shows the title, the app, every label and description, and prose", () => {
		root = new InteractionModal(sampleModal(), host()).show();

		expect(q(".interactionModalTitle").textContent).toBe("Edit persona");
		expect(q(".interactionModalApp").textContent).toBe("Tzurot");
		const labels = [...root.querySelectorAll(".interactionModalLabel")].map((l) => l.textContent);
		expect(labels).toEqual(["Name", "Backstory", "Model", "Tone", "Features", "Public"]);
		expect(q(".interactionModalDescription").textContent).toBe("Shown above replies");
		expect(q(".interactionModalText").textContent).toContain("Changes apply to new messages.");
		expect(q<HTMLInputElement>('input[data-custom-id="name"]').value).toBe("Alice");
		expect(q<HTMLTextAreaElement>('textarea[data-custom-id="story"]').placeholder).toBe("Optional");
	});

	it("submits every field in Discord's modal-submit shape, with the opener's message", async () => {
		const sent = captureRequests(API + "/interactions");
		const modal = new InteractionModal(sampleModal(), host("500"));
		root = modal.show();
		q<HTMLInputElement>('input[value="warm"]').click();
		q<HTMLInputElement>('input[value="voice"]').click();
		q<HTMLInputElement>('input[data-custom-id="public"]').click();

		expect(await modal.submit()).toBe(true);

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			type: 5,
			application_id: "300",
			channel_id: "200",
			guild_id: "400",
			message_id: "500",
			session_id: "session-1",
			data: {
				id: "1100",
				custom_id: "persona-edit",
				components: [
					{type: 10},
					{type: 18, component: {type: 4, custom_id: "name", value: "Alice"}},
					{type: 18, component: {type: 4, custom_id: "story", value: ""}},
					{type: 18, component: {type: 3, custom_id: "model", values: ["l"]}},
					{type: 18, component: {type: 21, custom_id: "tone", value: "warm"}},
					{type: 18, component: {type: 22, custom_id: "features", values: ["voice", "images"]}},
					{type: 18, component: {type: 23, custom_id: "public", value: true}},
				],
			},
		});
		expect(typeof (sent[0] as {nonce: unknown}).nonce).toBe("string");
		expect(document.contains(root)).toBe(false);
	});

	it("sends no message_id when a slash command opened the modal", async () => {
		const sent = captureRequests(API + "/interactions");
		const modal = new InteractionModal(sampleModal(), host());
		root = modal.show();
		q<HTMLInputElement>('input[value="dry"]').click();

		await modal.submit();

		expect(sent[0]).not.toHaveProperty("message_id");
	});

	it("blocks the submit and marks the fields a required or length rule rejects", async () => {
		const sent = captureRequests(API + "/interactions");
		const modal = new InteractionModal(sampleModal(), host());
		root = modal.show();
		q<HTMLInputElement>('input[data-custom-id="name"]').value = "L";

		expect(await modal.submit()).toBe(false);

		expect(sent).toHaveLength(0);
		expect(
			field("name").closest(".interactionModalField")!.querySelector(".interactionModalError")!
				.textContent,
		).not.toBe("");
		// Tone is a required radio group with nothing picked
		expect(
			field("tone").closest(".interactionModalField")!.querySelector(".interactionModalError")!
				.textContent,
		).not.toBe("");
		// Backstory is optional and empty
		expect(
			field("story").closest(".interactionModalField")!.querySelector(".interactionModalError")!
				.textContent,
		).toBe("");
		expect(document.contains(root)).toBe(true);
	});

	it("stays open with the server's reason when the submit is refused", async () => {
		captureRequests(
			API + "/interactions",
			() =>
				new Response(JSON.stringify({code: 10062, message: "Unknown interaction"}), {
					status: 404,
					headers: {"Content-Type": "application/json"},
				}),
		);
		const modal = new InteractionModal(sampleModal(), host());
		root = modal.show();
		q<HTMLInputElement>('input[value="dry"]').click();

		expect(await modal.submit()).toBe(false);

		expect(document.contains(root)).toBe(true);
		expect(q(".interactionModalFormError").textContent).toContain("Unknown interaction");
	});

	it("submits a legacy action-row text input as an action row", async () => {
		const sent = captureRequests(API + "/interactions");
		const modal = new InteractionModal(
			{
				...sampleModal(),
				components: [
					{
						type: 1,
						components: [{type: 4, custom_id: "old", style: 1, label: "Old style", value: "x"}],
					},
				],
			},
			host(),
		);
		root = modal.show();

		expect(q(".interactionModalLabel").textContent).toBe("Old style");
		await modal.submit();

		expect((sent[0] as {data: {components: unknown}}).data.components).toEqual([
			{type: 1, components: [{type: 4, custom_id: "old", value: "x"}]},
		]);
	});

	it("shows the server's field errors under their fields (Spacebar's flat error keys)", async () => {
		// spacebar-server FieldErrors: flat dotted keys, passed through by its ErrorHandler.
		captureRequests(
			API + "/interactions",
			() =>
				new Response(
					JSON.stringify({
						code: 50035,
						message: "Invalid Form Body",
						errors: {
							"data.components.1.component.value": {
								_errors: [{code: "BASE_TYPE_BAD_LENGTH", message: "Name is taken"}],
							},
						},
					}),
					{status: 400, headers: {"Content-Type": "application/json"}},
				),
		);
		const modal = new InteractionModal(sampleModal(), host());
		root = modal.show();
		q<HTMLInputElement>('input[value="dry"]').click();

		expect(await modal.submit()).toBe(false);

		expect(q(".interactionModalFormError").textContent).toContain("Invalid Form Body");
		const nameError = field("name")
			.closest(".interactionModalField")!
			.querySelector(".interactionModalError")!;
		expect(nameError.textContent).toBe("Name is taken");
	});

	it("stays open on a tap outside it, so typed answers survive", async () => {
		root = new InteractionModal(sampleModal(), host()).show();
		const background = root.closest(".background") as HTMLElement;

		background.click();
		await new Promise((res) => setTimeout(res, 600));

		expect(document.contains(root)).toBe(true);
	});

	it("closes on Escape", async () => {
		root = new InteractionModal(sampleModal(), host()).show();
		const background = root.closest(".background") as HTMLElement;

		background.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
		await new Promise((res) => setTimeout(res, 600));

		expect(document.contains(root)).toBe(false);
	});

	it("submits on Enter in a short text input", async () => {
		const sent = captureRequests(API + "/interactions");
		root = new InteractionModal(sampleModal(), host()).show();
		q<HTMLInputElement>('input[value="dry"]').click();

		q<HTMLInputElement>('input[data-custom-id="name"]').dispatchEvent(
			new KeyboardEvent("keydown", {key: "Enter", bubbles: true}),
		);
		await vi.waitUntil(() => sent.length === 1, {timeout: 2000});

		expect(sent).toHaveLength(1);
	});

	it("sends once when Enter is pressed again while the first send is out", async () => {
		const sent = captureRequests(API + "/interactions");
		root = new InteractionModal(sampleModal(), host()).show();
		q<HTMLInputElement>('input[value="dry"]').click();
		const name = q<HTMLInputElement>('input[data-custom-id="name"]');

		name.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
		name.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
		await vi.waitUntil(() => sent.length >= 1, {timeout: 2000});
		await new Promise((res) => setTimeout(res, 100));

		expect(sent).toHaveLength(1);
	});
});

describe("INTERACTION_MODAL_CREATE from the gateway", () => {
	/** Just enough of a logged-in session for handleEvent's modal path. */
	function session() {
		return Object.assign(Object.create(Localuser.prototype), {
			interNonceMap: new Map(),
			interactionNonces: new Set(),
			guilds: [],
			guildids: new Map([["@me", {channels: []}]]),
			// Every event refreshes the favicon badge, which needs the app page's <link rel="icon">.
			generateFavicon: () => {},
			channelids: new Map(),
			info: {api: API},
			headers: {"Content-type": "application/json", Authorization: "token"},
			session_id: "session-1",
		}) as InstanceType<typeof Localuser>;
	}
	const event = (nonce: string) => ({
		op: 0,
		t: "INTERACTION_MODAL_CREATE",
		d: {...sampleModal(), nonce},
		s: 1,
	});
	const open = () => document.querySelector(".interactionModal");

	it("opens only in the session whose interaction opened it", async () => {
		const other = session();

		await other.handleEvent(event("42") as never);

		expect(open()).toBeNull();
	});

	it("opens for this session's button and names the button's message on submit", async () => {
		const sent = captureRequests(API + "/interactions");
		const user = session();
		user.registerInterNonce("42", {id: "500"} as never);

		await user.handleEvent(event("42") as never);
		root = open() as HTMLElement;
		expect(root).not.toBeNull();
		q<HTMLInputElement>('input[value="dry"]').click();
		(q(".interactionModalSubmit") as HTMLButtonElement).click();
		await vi.waitUntil(() => sent.length === 1, {timeout: 2000});

		expect(sent[0]).toMatchObject({message_id: "500", type: 5});
		// The bot's answer (or its failure) to the submit shows on the opener message.
		const submitNonce = (sent[0] as {nonce: string}).nonce;
		expect(user.interNonceMap.get(submitNonce)).toEqual({id: "500"});
	});

	it("opens for this session's slash command, with no message on submit", async () => {
		const sent = captureRequests(API + "/interactions");
		const user = session();
		user.registerCommandNonce("77");

		await user.handleEvent(event("77") as never);
		root = open() as HTMLElement;
		q<HTMLInputElement>('input[value="dry"]').click();
		(q(".interactionModalSubmit") as HTMLButtonElement).click();
		await vi.waitUntil(() => sent.length === 1, {timeout: 2000});

		expect(sent[0]).not.toHaveProperty("message_id");
	});
});
