import {afterEach, expect, it, vi} from "vitest";
import type {Member as MemberT} from "./member";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {User} = await import("./user");
const {Member} = await import("./member");
const {Search} = await import("./search");
const {I18n} = await import("./i18n");
await I18n.done;

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll(".profile").forEach((e) => e.remove());
});

function role(id: string, name: string, manageable: boolean) {
	return {
		id,
		name,
		getColorStyle: () => "#aa0000",
		canManage: () => manageable,
	};
}

/** A user popout for a member holding `roles`, opened at real coordinates so it mounts in the DOM. */
async function openPopout(
	roles: object[],
	viewerCanManageRoles: boolean,
	extra: Record<string, unknown> = {},
	x = 20,
) {
	const {Localuser} = await import("./localuser");
	const localuser = Object.assign(Object.create(Localuser.prototype), {
		info: {api: "http://popout.test/api/v9", cdn: "http://popout.test", wellknown: "http://popout.test"},
		headers: {},
		user: {id: "me-1"},
		userMap: new Map(),
		guilds: [],
		// buildprofile's friend-request poll calls relationChange ~100 ms in; this constructor
		// field is what the prototype fake skips.
		relChangeUpdateMap: new Map(),
	});
	const user = new User(
		{
			id: "1553128655016763450",
			username: "alice",
			discriminator: "0001",
			avatar: null,
			bot: false,
			public_flags: 0,
			badge_ids: [],
			accent_color: 0,
			bio: "",
			premium_type: 0,
			premium_since: "",
			theme_colors: null,
		},
		localuser,
		true,
	);
	const stub = Object.assign(Object.create(Member.prototype), {
		id: user.id,
		user,
		// Member.roles filters owner.roles by roleIds, so both carry the role list.
		roleIds: new Set(roles.map((r) => (r as {id: string}).id)),
		pronouns: "",
		bio: "",
		getBannerUrl: () => undefined,
		hasPermission: () => viewerCanManageRoles,
		subName: () => {},
		...extra,
	}) as MemberT;
	// The self-member back-reference the popout's MANAGE_ROLES gate reads.
	Object.assign(stub, {
		owner: {
			id: "g1",
			roles,
			roleids: new Map(roles.map((r) => [(r as {id: string}).id, r])),
			properties: {name: "Wonderland"},
			localuser,
			member: stub,
		},
	});
	return user.buildprofile(x, x, stub, 5);
}

function roleChips(popout: HTMLElement) {
	return Array.from(popout.querySelectorAll(".rolediv"));
}

it("a moderator sees an × on a manageable role chip; clicking it removes the role", async () => {
	const knights = role("r1", "Knights", true);
	const removeRole = vi.fn().mockResolvedValue(true);
	const popout = await openPopout([knights], true, {removeRole});
	await vi.waitFor(() => expect(roleChips(popout).length).toBe(1));
	const chip = roleChips(popout)[0]!;
	const remove = chip.querySelector(".removerole");
	expect(remove).not.toBeNull();
	remove!.dispatchEvent(new MouseEvent("click", {bubbles: true}));
	expect(removeRole).toHaveBeenCalledWith(knights);
});

it("a member without MANAGE_ROLES sees plain chips — no × and no +", async () => {
	const popout = await openPopout([role("r1", "Knights", true)], false);
	await vi.waitFor(() => expect(roleChips(popout).length).toBe(1));
	expect(popout.querySelector(".removerole")).toBeNull();
	expect(popout.querySelector(".addrole")).toBeNull();
});

it("the + chip offers manageable roles and picking one adds it", async () => {
	const pagans = role("r2", "Pagans", true);
	const addRole = vi.fn().mockResolvedValue(true);
	const popout = await openPopout([], true, {addRole});
	await vi.waitFor(() =>
		expect(popout.querySelector(".addrole")).not.toBeNull(),
	);
	const find = vi.spyOn(Search.prototype, "find").mockResolvedValue(pagans);
	popout.querySelector<HTMLButtonElement>(".addrole")!.click();
	await vi.waitFor(() => expect(addRole).toHaveBeenCalledWith(pagans));
	expect(find).toHaveBeenCalledOnce();
});

it("the edit-profile preview (x=-1 clone) renders no role controls — × there would fire the real member's kick route", async () => {
	const popout = await openPopout(
		[role("r1", "Knights", true)],
		true,
		// editProfile's preview passes this.clone(), whose id carries the #clone suffix.
		{id: "1553128655016763450#clone"},
		-1,
	);
	await vi.waitFor(() => expect(roleChips(popout).length).toBe(1));
	expect(popout.querySelector(".removerole")).toBeNull();
	expect(popout.querySelector(".addrole")).toBeNull();
});

it("the everyone-role never renders a chip, so it can never grow a control", async () => {
	const popout = await openPopout(
		[role("r1", "Knights", true), role("g1", "@everyone", true)],
		true,
	);
	await vi.waitFor(() => expect(roleChips(popout).length).toBe(1));
	expect(roleChips(popout)[0]!.textContent).not.toContain("@everyone");
});

it("a member bio renders its role mention against the popout's guild", async () => {
	// Digit-only id: the mention parser reads ids as numbers.
	const popout = await openPopout([role("222", "Knights", false)], false, {
		bio: "sword <@&222>",
	});
	await vi.waitFor(() => expect(popout.textContent).toContain("@Knights"));
});
