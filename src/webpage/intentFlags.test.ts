import {describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order — same bootstrap as the other suites.
await import("./localuser");
const {Localuser} = await import("./localuser");
const {Dialog} = await import("./settings");
const {INTENT_LIMITED_BITS, INTENT_FULL_BITS, foldIntentFlags, intentShown} = await import(
	"./intentFlags"
);

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});
}

const OTHER_FLAGS =
	(1 << 12) | // presence full bit
	(1 << 19) | // message content limited bit
	(1 << 24); // an unrelated flag that must survive every fold

describe("intentShown", () => {
	it("is on for a limited bit alone", () => {
		expect(intentShown(INTENT_LIMITED_BITS.guildMembers, "guildMembers")).toBe(true);
	});

	it("is on for a full bit alone", () => {
		expect(intentShown(INTENT_FULL_BITS.presence, "presence")).toBe(true);
	});

	it("is off with neither bit set", () => {
		expect(intentShown(OTHER_FLAGS, "guildMembers")).toBe(false);
	});

	it("reads only its own intent's bits", () => {
		// messageContent's bits are set in OTHER_FLAGS; guildMembers' are not.
		expect(intentShown(OTHER_FLAGS, "messageContent")).toBe(true);
		expect(intentShown(OTHER_FLAGS, "guildMembers")).toBe(false);
	});
});

describe("foldIntentFlags", () => {
	it("sets a limited bit when the toggle is on", () => {
		const out = foldIntentFlags(OTHER_FLAGS, {
			presence: false,
			guildMembers: true,
			messageContent: false,
		});
		expect(out & INTENT_LIMITED_BITS.guildMembers).not.toBe(0);
	});

	it("clears a limited bit when the toggle is off", () => {
		const out = foldIntentFlags(OTHER_FLAGS, {
			presence: false,
			guildMembers: false,
			messageContent: false,
		});
		expect(out & INTENT_LIMITED_BITS.messageContent).toBe(0);
	});

	it("never changes a full bit, even with the toggle off", () => {
		const out = foldIntentFlags(OTHER_FLAGS, {
			presence: false,
			guildMembers: false,
			messageContent: false,
		});
		expect(out & INTENT_FULL_BITS.presence).not.toBe(0);
	});

	it("passes unrelated flags through untouched", () => {
		const out = foldIntentFlags(OTHER_FLAGS, {
			presence: true,
			guildMembers: true,
			messageContent: true,
		});
		expect(out & (1 << 24)).not.toBe(0);
	});

	it("is a no-op when the toggles match the read limited bits", () => {
		const read = INTENT_LIMITED_BITS.presence | INTENT_LIMITED_BITS.messageContent;
		const out = foldIntentFlags(read, {
			presence: true,
			guildMembers: false,
			messageContent: true,
		});
		expect(out).toBe(read);
	});
});

describe("the application edit form's flags wiring", () => {
	const APP_ID = "1000000000000000301";
	const API = "http://intent.test/api/v9";
	// Presence's full bit, message content's limited bit, and an unrelated flag: the toggles
	// therefore init to presence on (full bit), members off, message content on.
	const READ = INTENT_FULL_BITS.presence | INTENT_LIMITED_BITS.messageContent | (1 << 24);

	/** Runs manageApplication against a stub localuser and the real form machinery. An omitted
	 * read leaves flags out of the answer entirely (a shape the server answer says shouldn't
	 * happen, but the form must not PATCH garbage derived from it). No default parameter:
	 * an explicit `undefined` argument must not silently become READ. */
	async function openAppForm(read?: number, answerFlags?: (call: number) => number | undefined) {
		const answerBody: Record<string, unknown> = {
			name: "Intent App",
			description: "",
			icon: null,
			privacy_policy_url: "",
			terms_of_service_url: "",
			bot_public: true,
			bot_require_code_grant: false,
			bot: false,
			verify_key: "",
		};
		if (read !== undefined) answerBody.flags = read;
		let call = 0;
		const answer = () => {
			call++;
			if (answerFlags) {
				const flags = answerFlags(call);
				if (flags === undefined) delete answerBody.flags;
				else answerBody.flags = flags;
			}
			return json(answerBody);
		};
		const sent = captureRequests(`${API}/applications/${APP_ID}`, answer);
		const stub = Object.create(Localuser.prototype) as InstanceType<typeof Localuser>;
		// Fields the constructor would have set; perminfo reads userinfo.localuserStore.
		(stub as any).userinfo = {localuserStore: {}};
		(stub as any).headers = {"Content-type": "application/json"};
		(stub as any).info = {api: API, cdn: "http://intent.test"};
		(stub as any).botTokens = new Map();
		const real = new Dialog("").options;
		const forms: any[] = [];
		const container = {
			addSubForm: (...args: any[]) => {
				const form = real.addSubForm(...(args as Parameters<typeof real.addSubForm>));
				forms.push(form);
				return form;
			},
		};
		await stub.manageApplication(APP_ID, container as any, () => {});
		return {sent, form: forms[0]};
	}

	/** Waits for the form's fetch chain: `atLeast` bodies captured on the form's URL. */
	const settle = (sent: unknown[], atLeast = 1) =>
		vi.waitFor(() =>
			expect(sent.filter((b) => b && typeof b === "object").length).toBeGreaterThanOrEqual(
				atLeast,
			),
		);

	it("inits the toggles from either bit and PATCHes flags with the limited bits folded", async () => {
		const {sent, form} = await openAppForm(READ);
		expect(form).toBeDefined();

		// The init states prove intentShown's wiring: presence on via its full bit, message
		// content on via its limited bit, members off.
		expect(form.names.get("intent_presence").value).toBe(true);
		expect(form.names.get("intent_members").value).toBe(false);
		expect(form.names.get("intent_content").value).toBe(true);

		(form.names.get("intent_members") as {value: boolean}).value = true;
		// Flip content off too: it inits on via its limited bit, so the fold must CLEAR it —
		// the clearing path through the form, not just the pure function.
		(form.names.get("intent_content") as {value: boolean}).value = false;
		await form.submit();
		await settle(sent);

		const patch = sent.find(
			(body) => body && typeof body === "object",
		) as Record<string, number>;
		expect(patch).toBeDefined();
		// Only changed toggles fold: members flipped on adds its limited bit, content flipped
		// off clears its. Presence is untouched — on via its full bit alone — so it stays
		// as-read: no limited bit is granted on a save the user never aimed there.
		expect(patch.flags).toBe(
			(READ & ~INTENT_LIMITED_BITS.messageContent) | INTENT_LIMITED_BITS.guildMembers,
		);
		// The checkbox fields are form-local names; the PATCH carries only real fields.
		expect(Object.keys(patch).filter((key) => key.startsWith("intent_"))).toEqual([]);
		// The full bit and the unrelated flag passed through as read.
		expect(patch.flags & (INTENT_FULL_BITS.presence | (1 << 24))).toBe(
			INTENT_FULL_BITS.presence | (1 << 24),
		);
	});

	it("an untouched full-bit-only intent gains no limited bit on save", async () => {
		// Presence granted outright (full bit, no limited bit) plus an unrelated flag: the
		// toggles show presence on, but the user touches nothing. The PATCH must carry the
		// read back unchanged — an untouched toggle says nothing about its limited bit, so a
		// save must not grant it (the owner's later revocation of the full bit would
		// otherwise leave the intent in force through a bit the user never chose).
		const read = INTENT_FULL_BITS.presence | (1 << 24);
		const {sent, form} = await openAppForm(read);
		expect(form).toBeDefined();
		expect(form.names.get("intent_presence").value).toBe(true);

		await form.submit();
		await settle(sent);

		const patch = sent.find(
			(body) => body && typeof body === "object",
		) as Record<string, number>;
		expect(patch).toBeDefined();
		expect(patch.flags).toBe(read);
	});

	it("a second save folds onto the PATCH answer's flags, not the boot-time read", async () => {
		// Save 1 flips members on; the server answers with a mask that now carries the bit
		// save 1 set plus a presence limited bit (the story's server-side addition). Save 2
		// flips content off and touches nothing else: presence must keep the bit the ANSWER
		// carries — the fold ran on the refreshed read — and members, now at its per-save
		// baseline of on, reads as untouched and stays set.
		const second = READ | INTENT_LIMITED_BITS.presence | INTENT_LIMITED_BITS.guildMembers;
		const {sent, form} = await openAppForm(READ, (n) => (n === 1 ? READ : second));
		(form.names.get("intent_members") as {value: boolean}).value = true;
		await form.submit();
		await settle(sent);
		(form.names.get("intent_content") as {value: boolean}).value = false;
		await form.submit();
		await settle(sent, 2);

		const saves = sent.filter((b) => b && typeof b === "object") as Record<string, number>[];
		expect(saves).toHaveLength(2);
		expect(saves[1].flags).toBe(second & ~INTENT_LIMITED_BITS.messageContent);
	});

	it("a toggle switched back to its starting value is honoured on a later save", async () => {
		// Content starts on (its limited bit is in READ). Save 1 turns it off and the server
		// answers without the bit; save 2 turns it back ON. The baseline must be "the last
		// save", not the form open: on = false baseline after save 1, so save 2's on is a
		// change and re-sets the bit. With the baseline stuck at open (true), the on reads as
		// untouched and the save silently keeps the intent off — the checkbox lies.
		const answer2 = READ & ~INTENT_LIMITED_BITS.messageContent;
		const {sent, form} = await openAppForm(READ, (n) => (n === 1 ? READ : n === 2 ? answer2 : READ));
		(form.names.get("intent_content") as {value: boolean}).value = false;
		await form.submit();
		await settle(sent);
		(form.names.get("intent_content") as {value: boolean}).value = true;
		await form.submit();
		await settle(sent, 2);

		const saves = sent.filter((b) => b && typeof b === "object") as Record<string, number>[];
		expect(saves).toHaveLength(2);
		expect(saves[1].flags).toBe(READ);
	});

	it("a read without a numeric flags PATCHes no flags at all instead of garbage", async () => {
		const {sent, form} = await openAppForm(undefined);
		expect(form).toBeDefined();
		// The toggles init to false from the missing read; folding them into `undefined`
		// would PATCH a derived number and let the server zero the stored flags.
		expect(form.names.get("intent_presence").value).toBe(false);

		await form.submit();
		await settle(sent);

		const patch = sent.find(
			(body) => body && typeof body === "object",
		) as Record<string, unknown>;
		expect(patch).toBeDefined();
		expect("flags" in patch).toBe(false);
		expect(Object.keys(patch).filter((key) => key.startsWith("intent_"))).toEqual([]);
	});
});
