import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Settings} = await import("./settings");

afterEach(() => {
	vi.restoreAllMocks();
});

type Input = {onchange: (value: string) => void; submit(): void};

/**
 * Opens the user's own profile editor and hands back its pronouns box, colour picker and the
 * options the picker opened with. Only the profile tab is under test: the rest of the settings
 * may fail on this stub user, after the profile tab is built.
 */
async function openProfile(user: Record<string, unknown>) {
	const options = Object.getPrototypeOf(new Settings("").addButton("probe"));
	const text = vi.spyOn(options, "addTextInput");
	const color = vi.spyOn(options, "addColorInput");
	const saved: object[] = [];
	const localuser = Object.create(Localuser.prototype);
	// The preview copy of the user the editor draws as fields change.
	const hypo = {pronouns: "", bio: "", buildprofile: async () => document.createElement("div")};
	Object.assign(localuser, {
		user: {pronouns: "", bio: {rawString: ""}, getpfpsrc: () => "", clone: () => hypo, ...user},
		updateProfile: (json: object) => saved.push(json),
	});
	await localuser.showusersettings().catch(() => {});
	const pronouns = text.mock.results[0].value as Input;
	const picker = color.mock.results[0].value as Input;
	return {saved, pronouns, picker, pickerOpened: color.mock.calls[0]};
}

it("saving the profile without touching the colour sends no colour", async () => {
	const {saved, pronouns} = await openProfile({});

	pronouns.onchange("she/her");
	pronouns.submit();

	expect(saved).toHaveLength(1);
	expect(saved[0]).not.toHaveProperty("accent_color");
});

it("saving with nothing edited sends nothing", async () => {
	const {saved, pronouns} = await openProfile({});

	pronouns.submit();

	expect(saved).toEqual([]);
});

it("a picked colour is saved as its number (the control)", async () => {
	const {saved, pronouns, picker} = await openProfile({});

	picker.onchange("#00ff00");
	pronouns.submit();

	expect(saved).toEqual([expect.objectContaining({accent_color: 0x00ff00})]);
});

it("a dark accent colour opens as a full colour in the picker", async () => {
	const {pickerOpened} = await openProfile({accent_color: 0x0000ff});

	expect(pickerOpened[2]).toEqual({initColor: "#0000ff"});
});

it("a dark folder colour opens as a full colour in the folder's picker", async () => {
	const {Contextmenu} = await import("./contextmenu");
	const added = vi.spyOn(Contextmenu.prototype, "addButton");
	const color = vi.spyOn(
		Object.getPrototypeOf(new Settings("").addButton("probe")),
		"addColorInput",
	);
	const localuser = Object.create(Localuser.prototype);
	// Folder open states live in the account's stored info; dragging needs the sidebar.
	Object.defineProperty(localuser, "perminfo", {value: {}});
	localuser.makeGuildDragable = () => {};
	localuser.makeFolder({color: 0x0000ff, id: 1, name: "f", guilds: []});

	// The folder's "edit" menu entry opens the dialog holding the picker.
	(added.mock.calls[0][1] as () => void)();

	expect(color.mock.calls[0][2]).toEqual({initColor: "#0000ff"});
	document.querySelectorAll("dialog, .PopUp").forEach((e) => e.remove());
});
