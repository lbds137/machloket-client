import {describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");

describe("submitting a slash command", () => {
	it("a second Enter while the first is still sending runs the command once", async () => {
		const pending: ((ok: boolean) => void)[] = [];
		const submit = vi.fn(() => new Promise<boolean>((res) => pending.push(res)));
		const channel = Object.assign(Object.create(Channel.prototype), {
			curCommand: {submit},
			exitCommand: vi.fn(),
		}) as InstanceType<typeof Channel>;

		const first = channel.submitCommand();
		const second = channel.submitCommand();
		for (const answer of pending) answer(true);
		await Promise.all([first, second]);

		expect(submit).toHaveBeenCalledTimes(1);
		expect(channel.exitCommand).toHaveBeenCalledTimes(1);
	});

	it("after a refused submit (a validation error), Enter can send again", async () => {
		const submit = vi.fn(async () => false);
		const channel = Object.assign(Object.create(Channel.prototype), {
			curCommand: {submit},
			exitCommand: vi.fn(),
		}) as InstanceType<typeof Channel>;

		await channel.submitCommand();
		await channel.submitCommand();

		expect(submit).toHaveBeenCalledTimes(2);
	});
});
