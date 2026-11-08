import {describe, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order — same bootstrap as the other suites.
await import("./localuser");
const {Localuser} = await import("./localuser");
const {Dialog} = await import("./settings");
const {I18n} = await import("./i18n");
const {INTENT_LIMITED_BITS, INTENT_FULL_BITS, foldIntentFlags, intentShown} = await import(
	"./intentFlags"
);
await I18n.done;

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
	async function openAppForm(
		read?: unknown,
		answerFlags?: (call: number) => number | undefined,
		answerStatus?: (call: number) => number,
	) {
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
			return json(answerBody, answerStatus?.(call));
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
		// toggles show presence on, but the user touches nothing. A save that changes no
		// intent toggle sends no flags key at all — it can neither grant a limited bit the
		// user never chose nor overwrite a concurrent intent change from another tab.
		const read = INTENT_FULL_BITS.presence | (1 << 24);
		const {sent, form} = await openAppForm(read);
		expect(form).toBeDefined();
		expect(form.names.get("intent_presence").value).toBe(true);

		await form.submit();
		await settle(sent);

		const patch = sent.find(
			(body) => body && typeof body === "object",
		) as Record<string, unknown>;
		expect(patch).toBeDefined();
		expect("flags" in patch).toBe(false);
	});

	it("refreshes the checkboxes from the PATCH answer so a masked-back bit can be cleared again", async () => {
		const both = INTENT_FULL_BITS.presence | INTENT_LIMITED_BITS.presence;
		const fullOnly = INTENT_FULL_BITS.presence;
		const {sent, form} = await openAppForm(both, (n) => (n === 1 ? both : fullOnly));
		expect(form.names.get("intent_presence").value).toBe(true);

		(form.names.get("intent_presence") as {value: boolean}).value = false;
		await form.submit();
		await settle(sent);

		// The server cleared only the limited bit; the full bit keeps the intent on, so the
		// checkbox must follow the answer back to true along with the baseline.
		expect(form.names.get("intent_presence").value).toBe(true);

		(form.names.get("intent_presence") as {value: boolean}).value = false;
		await form.submit();
		await settle(sent, 2);

		const saves = sent.filter((b) => b && typeof b === "object") as Record<string, number>[];
		expect(saves).toHaveLength(2);
		expect("flags" in saves[1]).toBe(true);
		expect(saves[1].flags & INTENT_LIMITED_BITS.presence).toBe(0);
		expect(saves[1].flags).toBe(fullOnly);
	});

	it("a box the user changed while the PATCH was in flight keeps their change", async () => {
		// READ has content on, members off. Save 1 turns members on; while that PATCH is out,
		// the user unticks content. The answer (members on, content still on) must not re-tick
		// content: it moves the baseline, and the untick then counts as a change on save 2.
		let formRef: any;
		const answer1 = READ | INTENT_LIMITED_BITS.guildMembers;
		const {sent, form} = await openAppForm(READ, (n) => {
			if (n === 2) {
				const input = (
					formRef.names.get("intent_content") as {input: WeakRef<HTMLInputElement>}
				).input.deref()!;
				input.checked = false;
				input.dispatchEvent(new Event("input"));
			}
			return n === 1 ? READ : answer1;
		});
		formRef = form;
		(form.names.get("intent_members") as {value: boolean}).value = true;
		await form.submit();
		await settle(sent);

		expect(form.names.get("intent_content").value).toBe(false);
		expect(form.names.get("intent_members").value).toBe(true);

		await form.submit();
		await settle(sent, 2);
		const saves = sent.filter((b) => b && typeof b === "object") as Record<string, number>[];
		expect(saves).toHaveLength(2);
		expect(saves[1].flags).toBe(answer1 & ~INTENT_LIMITED_BITS.messageContent);
	});

	it("CheckboxInput.setState updates value when the input was never generated", () => {
		const options = new Dialog("").options;
		options.container = {deref: () => undefined} as WeakRef<HTMLDivElement>;
		const ungenerated = options.addCheckboxInput("x", () => {});
		expect(ungenerated.input).toBeUndefined();
		ungenerated.setState(true);
		expect(ungenerated.value).toBe(true);
	});

	it("CheckboxInput.setState updates value when its WeakRef target is gone", () => {
		const unmounted = new Dialog("").options.addCheckboxInput("y", () => {});
		unmounted.input = {deref: () => undefined} as WeakRef<HTMLInputElement>;
		unmounted.setState(true);
		expect(unmounted.value).toBe(true);
	});

	it("CheckboxInput.disabled is read-only: only setDisabled changes it, and the DOM follows", () => {
		const box = new Dialog("").options.addCheckboxInput("z", () => {});
		box.generateHTML();
		const input = box.input.deref()!;
		box.setDisabled(true);
		expect(box.disabled).toBe(true);
		expect(input.disabled).toBe(true);
		expect(() => {
			// @ts-expect-error disabled has no setter; a direct write would skip the DOM
			box.disabled = false;
		}).toThrow(TypeError);
		expect(box.disabled).toBe(true);
		expect(input.disabled).toBe(true);
	});

	it("disables the three intent inputs on an invalid flags read (-1) and keeps them enabled on a valid read", async () => {
		const {form: invalidForm} = await openAppForm(-1);
		invalidForm.generateHTML();
		for (const field of ["intent_presence", "intent_members", "intent_content"]) {
			expect(
				(invalidForm.names.get(field) as {input: WeakRef<HTMLInputElement>}).input.deref()!
					.disabled,
			).toBe(true);
		}

		const {form: validForm} = await openAppForm(READ);
		validForm.generateHTML();
		for (const field of ["intent_presence", "intent_members", "intent_content"]) {
			expect(
				(validForm.names.get(field) as {input: WeakRef<HTMLInputElement>}).input.deref()!
					.disabled,
			).toBe(false);
		}
	});

	it("an answer with invalid flags moves neither the boxes nor the baseline", async () => {
		const {sent, form} = await openAppForm(READ, (n) => (n === 1 ? READ : -1));
		(form.names.get("intent_members") as {value: boolean}).value = true;
		await form.submit();
		await settle(sent);

		// -1 would read as every intent on, moving the baseline to "all on" so save 2 would
		// see no change and send no flags; the refresh must skip it, keeping members a change.
		await form.submit();
		await settle(sent, 2);
		const saves = sent.filter((b) => b && typeof b === "object") as Record<string, number>[];
		expect(saves).toHaveLength(2);
		expect(saves[1].flags).toBe(READ | INTENT_LIMITED_BITS.guildMembers);
	});

	it.each(["8192", 1.5, -1, 2147483648])(
		"an invalid flags read (%j) inits the toggles off and PATCHes no flags key",
		async (bad) => {
			const {sent, form} = await openAppForm(bad);
			expect(form).toBeDefined();
			expect(form.names.get("intent_presence").value).toBe(false);
			expect(form.names.get("intent_members").value).toBe(false);
			expect(form.names.get("intent_content").value).toBe(false);

			(form.names.get("intent_members") as {value: boolean}).value = true;
			await form.submit();
			await settle(sent);

			const patch = sent.find(
				(body) => body && typeof body === "object",
			) as Record<string, unknown>;
			expect(patch).toBeDefined();
			expect("flags" in patch).toBe(false);
		},
	);

	it("a failed save keeps the baseline so a retry still PATCHes the changed toggle", async () => {
		const {sent, form} = await openAppForm(
			READ,
			undefined,
			(n) => (n === 2 ? 500 : 200),
		);
		(form.names.get("intent_members") as {value: boolean}).value = true;
		await form.submit();
		await settle(sent);

		// No further change before the retry: because save 1 failed (500), onSubmit never
		// moved initStates, so members is still changed relative to the baseline.
		await form.submit();
		await settle(sent, 2);

		const saves = sent.filter((b) => b && typeof b === "object") as Record<string, number>[];
		expect(saves).toHaveLength(2);
		expect(saves[1].flags).toBe(READ | INTENT_LIMITED_BITS.guildMembers);
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

	it("an invalid boot read shows intentsUnreadable", async () => {
		const {form: validForm} = await openAppForm(READ);
		const {form} = await openAppForm(-1);
		const html = form.generateHTML();
		expect(html.textContent).toContain(I18n.localuser.intentsUnreadable());
		expect(form.options.options).toHaveLength(validForm.options.options.length + 1);
	});

	it("a valid boot read does not show intentsUnreadable", async () => {
		const {form} = await openAppForm(READ);
		const html = form.generateHTML();
		expect(html.textContent).not.toContain(I18n.localuser.intentsUnreadable());
	});

	it("boxes disabled by an invalid read come back on once a save answers with valid flags", async () => {
		// Call 1 is the boot read (invalid); call 2 answers the save with valid flags.
		const {sent, form} = await openAppForm(-1, (call) => (call === 1 ? -1 : READ));
		const html = form.generateHTML();
		const inputOf = (field: string) =>
			(form.names.get(field) as {input: WeakRef<HTMLInputElement>}).input.deref()!;
		expect(inputOf("intent_presence").disabled).toBe(true);
		expect(html.textContent).toContain(I18n.localuser.intentsUnreadable());

		await form.submit();
		await settle(sent);

		for (const field of ["intent_presence", "intent_members", "intent_content"]) {
			expect(inputOf(field).disabled, `${field} stayed disabled`).toBe(false);
		}
		expect(form.names.get("intent_presence").value).toBe(true);
		expect(html.textContent).not.toContain(I18n.localuser.intentsUnreadable());
	});

	it("a read without a numeric flags PATCHes no flags at all instead of garbage", async () => {
		const {sent, form} = await openAppForm(undefined);
		expect(form).toBeDefined();
		// The toggles init to false from the missing read; folding them into `undefined`
		// would PATCH a derived number and let the server zero the stored flags.
		expect(form.names.get("intent_presence").value).toBe(false);

		// A toggle changes, so the save reaches the read guard rather than the no-change path.
		(form.names.get("intent_members") as {value: boolean}).value = true;
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
