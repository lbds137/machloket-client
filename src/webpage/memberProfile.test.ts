import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Member} = await import("./member");
const {Settings} = await import("./settings");

afterEach(() => {
	vi.restoreAllMocks();
});

type Input = {onchange: (value: string) => void; submit(): void};

/** Opens a member's server-profile editor; hands back what it saves and its inputs. */
function openProfile(fields: Record<string, unknown>) {
	const options = new Settings("").addButton("probe");
	const proto = Object.getPrototypeOf(options);
	const text = vi.spyOn(proto, "addTextInput");
	const color = vi.spyOn(proto, "addColorInput");
	const saved: object[] = [];
	const member = Object.assign(Object.create(Member.prototype), {
		hasPermission: () => true,
		// The preview copy the editor draws as fields change.
		clone: () => ({user: {buildprofile: async () => document.createElement("div")}}),
		getpfpsrc: () => "",
		updateProfile: (json: object) => saved.push(json),
		pronouns: "",
		bio: "",
		...fields,
	});
	member.editProfile(options);
	const [nick, pronouns] = text.mock.results.map((r) => r.value as Input);
	return {saved, nick, pronouns, pickerOpened: color.mock.calls[0]};
}

it("saving with nothing edited sends nothing", () => {
	const {saved, pronouns} = openProfile({});

	pronouns.submit();

	expect(saved).toEqual([]);
});

it("a nickname edit alone is saved (the control)", () => {
	const {saved, nick, pronouns} = openProfile({});

	nick.onchange("Neo");
	pronouns.submit();

	expect(saved).toEqual([expect.objectContaining({nick: "Neo"})]);
});

it("a dark accent colour opens as a full colour in the picker", () => {
	const {pickerOpened} = openProfile({accent_color: 0x0000ff});

	expect(pickerOpened[2]).toEqual({initColor: "#0000ff"});
});
