import {afterEach, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Member} = await import("./member");
const {User} = await import("./user");
const {Guild} = await import("./guild");
const {Contextmenu} = await import("./contextmenu");

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

/** Renders one member row through the real list builder. */
async function renderRow() {
	document.body.innerHTML = `<div id="sideDiv"></div>`;
	const guild = Object.create(Guild.prototype);
	const user = Object.assign(Object.create(User.prototype), {
		id: "u1",
		bot: false,
		buildstatuspfp: () => document.createElement("img"),
	});
	const member = Object.assign(Object.create(Member.prototype), {
		user,
		owner: guild,
		nick: "Neo",
		subName: () => {},
		bind: () => {},
	});
	vi.spyOn(Member, "resolveMember").mockResolvedValue(member);
	const build = vi.spyOn(user, "buildprofile").mockResolvedValue(document.createElement("div"));
	const localuser = Object.create(Localuser.prototype);
	localuser.roleListMap = new WeakMap();
	localuser.generateListHTML(new Map([["online", [member]]]), {guild});
	const row = document.querySelector(".memberListStyle") as HTMLElement;
	return {row, build, guild};
}

it("tapping a member row opens that member's profile card", async () => {
	const {row, build, guild} = await renderRow();

	row.dispatchEvent(new MouseEvent("click", {bubbles: true, clientX: 12, clientY: 34}));

	expect(build).toHaveBeenCalledTimes(1);
	expect(build.mock.calls[0].slice(0, 3)).toEqual([12, 34, guild]);
});

const touchAt = (type: string, target: HTMLElement, live: boolean) => {
	const touch = new Touch({identifier: 1, target, pageX: 5, pageY: 5, clientX: 5, clientY: 5});
	return new TouchEvent(type, {
		bubbles: true,
		cancelable: true,
		touches: live ? [touch] : [],
		changedTouches: [touch],
	});
};

/** Presses the row for `ms`, lifts, and reports the menu opens and the lift event. */
async function press(ms: number) {
	const {row} = await renderRow();
	await new Promise((resolve) => setTimeout(resolve));
	const menu = vi.spyOn(Contextmenu.prototype, "makemenu").mockReturnValue(document.createElement("div"));
	vi.useFakeTimers();
	try {
		row.dispatchEvent(touchAt("touchstart", row, true));
		vi.advanceTimersByTime(ms);
		const lift = touchAt("touchend", row, false);
		row.dispatchEvent(lift);
		vi.advanceTimersByTime(600);
		return {menu, lift};
	} finally {
		vi.useRealTimers();
	}
}

it("a long-press opens the menu and cancels the click that would follow its lift", async () => {
	const {menu, lift} = await press(600);

	expect(menu).toHaveBeenCalledTimes(1);
	expect(lift.defaultPrevented).toBe(true);
});

it("a short tap opens no menu and leaves its click alone", async () => {
	const {menu, lift} = await press(100);

	expect(menu).not.toHaveBeenCalled();
	expect(lift.defaultPrevented).toBe(false);
});
