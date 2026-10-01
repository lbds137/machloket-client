import {describe, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first) — same bootstrap as the other suites.
await import("./localuser");
const {Message} = await import("./message.js");

describe("the used-command line on interaction replies", () => {
	/** A Message with only what usedLabel reads. `localuser` is getter-only on the
	 * prototype, so it needs a real own property. */
	function messageWith(interaction: {id: string; name?: string}, own?: string) {
		const message = Object.assign(Object.create(Message.prototype), {
			interaction,
			interaction_metadata: undefined,
		});
		Object.defineProperty(message, "localuser", {
			value: {interactionIdLabels: new Map(own ? [[interaction.id, own]] : [])},
			writable: true,
		});
		return message as never as {
			localuser: {interactionIdLabels: Map<string, string>};
			interaction?: {id: string; name?: string};
			interaction_metadata?: {name?: string};
		} & Record<string, unknown>;
	}

	it("prefers the invoker's own label — the full '/name sub' path", () => {
		const message = messageWith({id: "1", name: "walk"}, "walk browse") as never as {
			usedLabel: string | undefined;
		};
		expect(message.usedLabel).toBe("walk browse");
	});

	it("falls back to the name the message carries", () => {
		const message = messageWith({id: "1", name: "walk"}) as never as {
			usedLabel: string | undefined;
		};
		expect(message.usedLabel).toBe("walk");
	});

	it("falls back further to the metadata name when interaction carries none", () => {
		const message = messageWith({id: "1"});
		(message as unknown as {interaction_metadata?: {name?: string}}).interaction_metadata = {
			name: "probe",
		};
		expect((message as never as {usedLabel: string | undefined}).usedLabel).toBe("probe");
	});

	it("the chip renders '/name sub' as a pill", async () => {
		const {interactionCommandChip} = await import("./message.js");
		const chip = interactionCommandChip("walk browse");
		expect(chip.classList.contains("interactionCommand")).toBe(true);
		expect(chip.textContent).toBe("/walk browse");
	});
});
