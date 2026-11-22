import {describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Emoji} = await import("./emoji");
const {Sticker} = await import("./sticker");
const {User} = await import("./user");
const {Role} = await import("./role");
const {Guild} = await import("./guild");
const {Discovery} = await import("./discovery");
const {appIconElm} = await import("./interactions/commandPicker");

const CDN = "https://cdn.test";

/** Appends `elm` to a fresh attached container and returns the container. */
function mount(elm: HTMLElement): HTMLDivElement {
	const parent = document.createElement("div");
	parent.append(elm);
	document.body.append(parent);
	return parent;
}

describe("custom emoji whose image is gone", () => {
	it("shows its shortcode as text, keeping the raw token for copy", () => {
		const emoji = Object.assign(Object.create(Emoji.prototype), {
			id: "123456789012345678",
			name: "<:blob:123456789012345678>",
			animated: false,
			owner: {info: {cdn: CDN}, localuser: {}},
		}) as InstanceType<typeof Emoji>;
		const parent = mount(emoji.getHTML());
		try {
			parent.querySelector("img")?.dispatchEvent(new Event("error"));

			const fallback = parent.querySelector<HTMLElement>("span.md-emoji-fallback");
			expect(fallback).not.toBeNull();
			expect(fallback?.textContent).toBe(":blob:");
			expect(fallback?.getAttribute("real")).toBe("<:blob:123456789012345678>");
			expect(parent.querySelector("img")).toBeNull();
		} finally {
			parent.remove();
		}
	});

	it("the fallback is atomic in the composer: not editable, so typed text can't land inside it", () => {
		const emoji = Object.assign(Object.create(Emoji.prototype), {
			id: "123456789012345678",
			name: "<:blob:123456789012345678>",
			animated: false,
			owner: {info: {cdn: CDN}, localuser: {}},
		}) as InstanceType<typeof Emoji>;
		const parent = mount(emoji.getHTML());
		try {
			parent.querySelector("img")?.dispatchEvent(new Event("error"));

			const fallback = parent.querySelector<HTMLElement>("span.md-emoji-fallback");
			expect(fallback).not.toBeNull();
			expect(fallback?.contentEditable).toBe("false");
		} finally {
			parent.remove();
		}
	});

	it("a hostile name renders as text, never as markup", () => {
		const emoji = Object.assign(Object.create(Emoji.prototype), {
			id: "123456789012345678",
			name: ":<img src=x onerror=alert(1)>:",
			animated: false,
			owner: {info: {cdn: CDN}, localuser: {}},
		}) as InstanceType<typeof Emoji>;
		const parent = mount(emoji.getHTML());
		try {
			parent.querySelector("img")?.dispatchEvent(new Event("error"));

			const fallback = parent.querySelector<HTMLElement>("span.md-emoji-fallback");
			expect(fallback).not.toBeNull();
			expect(fallback?.querySelector("img") ?? null).toBeNull();
			expect(fallback?.textContent).toBe(":<img src=x onerror=alert(1)>:");
		} finally {
			parent.remove();
		}
	});
});

describe("custom emoji on the real network", () => {
	it("a 404 from the CDN shows the shortcode as text (the reserved missing id)", async () => {
		const emoji = new Emoji(
			{id: "404404404404404404", name: "<:gone:404404404404404404>", animated: false},
			{info: {cdn: ""}, localuser: {}} as unknown as InstanceType<typeof Guild>,
		);
		const holder = document.createElement("div");
		holder.append(emoji.getHTML());
		document.body.append(holder);
		try {
			// Connected, so the lazy img loads and the real response decides.
			await vi.waitFor(() => {
				expect(holder.querySelector("span.md-emoji-fallback")).not.toBeNull();
			});
			const fallback = holder.querySelector<HTMLElement>("span.md-emoji-fallback");
			expect(fallback?.textContent).toBe(":gone:");
			expect(fallback?.getAttribute("real")).toBe("<:gone:404404404404404404>");
		} finally {
			holder.remove();
		}
	});
});

describe("discovery images whose file is gone", () => {
	const discovery = () =>
		Object.assign(Object.create(Discovery.prototype), {
			owner: {info: {cdn: CDN}},
		}) as InstanceType<typeof Discovery>;

	it("an icon falls back to the embed avatar once; its error class clears on the fallback's load", () => {
		const img = discovery().getIconURL({
			id: "555",
			icon: "abc",
			banner: null,
		} as unknown as Parameters<InstanceType<typeof Discovery>["getIconURL"]>[0]);
		// Mocked so no network request runs; the test drives the events itself.
		const setSrcs = vi.spyOn(img, "setSrcs").mockImplementation(() => {});
		const parent = mount(img);
		try {
			img.dispatchEvent(new Event("error"));
			expect(setSrcs).toHaveBeenCalledTimes(1);
			expect(setSrcs).toHaveBeenLastCalledWith(`${CDN}/embed/avatars/3.png`);
			expect(img.classList.contains("error")).toBe(true);

			img.dispatchEvent(new Event("load"));
			expect(img.classList.contains("error")).toBe(false);

			img.dispatchEvent(new Event("error"));
			expect(setSrcs).toHaveBeenCalledTimes(1);
		} finally {
			setSrcs.mockRestore();
			parent.remove();
		}
	});

	it("a banner is removed when its file is gone", () => {
		const banner = discovery().getBannerURL({
			id: "556",
			banner: "bbb",
		} as unknown as Parameters<InstanceType<typeof Discovery>["getBannerURL"]>[0]);
		expect(banner).toBeTruthy();
		const parent = mount(banner as HTMLElement);
		try {
			(banner as HTMLElement).dispatchEvent(new Event("error"));
			expect((banner as HTMLElement).isConnected).toBe(false);
			expect(parent.querySelector("img")).toBeNull();
		} finally {
			parent.remove();
		}
	});
});

describe("app icon whose file is gone", () => {
	it("becomes the app's first letter, uppercased", () => {
		const localuser = {info: {cdn: CDN}} as unknown as Parameters<typeof appIconElm>[0];
		const app = {id: "777", icon: "ico", name: "tzurot"} as unknown as Parameters<
			typeof appIconElm
		>[1];
		const img = appIconElm(localuser, app);
		const parent = mount(img);
		try {
			img.dispatchEvent(new Event("error"));

			const letter = parent.querySelector<HTMLElement>("span.commandAppIconFallback");
			expect(letter).not.toBeNull();
			expect(letter?.textContent).toBe("T");
			expect(img.isConnected).toBe(false);
		} finally {
			parent.remove();
		}
	});
});

// Not covered here, each reachable only through a large internal flow: the webhook settings avatar
// (makeHook is a closure inside webhookMenu), the invite-page banner and icon (a top-level page
// script, nothing exported), the embed banner (inside Embed's async render path), and the emoji and
// sticker picker guild headers (built inside the picker functions).

describe("sticker whose image is gone", () => {
	it("shows its name as a bordered text box, with no image", () => {
		const sticker = Object.assign(Object.create(Sticker.prototype), {
			id: "223456789012345678",
			name: "wave",
			description: "",
			owner: {info: {cdn: CDN}},
		}) as InstanceType<typeof Sticker>;
		const parent = mount(sticker.getHTML());
		try {
			parent.querySelector("img")?.dispatchEvent(new Event("error"));

			const fallback = parent.querySelector<HTMLElement>("span.stickerFallback");
			expect(fallback).not.toBeNull();
			expect(fallback?.textContent).toBe("wave");
			expect(parent.querySelector("img")).toBeNull();
		} finally {
			parent.remove();
		}
	});
});

describe("avatar whose image is gone", () => {
	it("each new failing source gets its own default-avatar fallback; a failing default stops", () => {
		const defaultSrc = `${CDN}/embed/avatars/0.png`;
		const user = Object.assign(Object.create(User.prototype), {
			id: "111",
			avatar: "abc",
			webhook: false,
			owner: {info: {cdn: CDN}},
		}) as InstanceType<typeof User>;
		const wrapper = user.buildpfp(undefined, undefined);
		const pfp = wrapper.querySelector<HTMLImageElement>("img.pfp");
		expect(pfp).not.toBeNull();
		// Mocked so no network request runs; the test drives pfp.src itself.
		const setSrcs = vi
			.spyOn(pfp as HTMLImageElement & {setSrcs: (s: string) => void}, "setSrcs")
			.mockImplementation(() => {});
		try {
			// Own avatar is gone: point at the default.
			pfp?.dispatchEvent(new Event("error"));
			expect(setSrcs).toHaveBeenCalledTimes(1);
			expect(setSrcs).toHaveBeenLastCalledWith(defaultSrc);

			// A member avatar (or userupdate) points the img at a new source that also fails: it gets
			// its own fallback.
			pfp!.src = `${CDN}/avatars/111/new.png`;
			pfp?.dispatchEvent(new Event("error"));
			expect(setSrcs).toHaveBeenCalledTimes(2);
			expect(setSrcs).toHaveBeenLastCalledWith(defaultSrc);

			// The default itself fails: no further call.
			pfp!.src = defaultSrc;
			pfp?.dispatchEvent(new Event("error"));
			expect(setSrcs).toHaveBeenCalledTimes(2);
		} finally {
			setSrcs.mockRestore();
		}
	});
});

describe("role icon whose image is gone", () => {
	it("falls back to the unicode emoji when the role has one", () => {
		const role = Object.assign(Object.create(Role.prototype), {
			id: "333",
			name: "Helpers",
			icon: "abc",
			unicode_emoji: "🔥",
			info: {cdn: CDN},
		}) as InstanceType<typeof Role>;
		const icon = role.getIcon() as HTMLElement;
		const parent = mount(icon);
		try {
			icon.dispatchEvent(new Event("error"));

			const fallback = parent.querySelector<HTMLElement>("span.roleIcon");
			expect(fallback).not.toBeNull();
			expect(fallback?.textContent).toBe("🔥");
			expect(parent.querySelector("img")).toBeNull();
		} finally {
			parent.remove();
		}
	});

	it("is removed when the role has no unicode emoji", () => {
		const role = Object.assign(Object.create(Role.prototype), {
			id: "334",
			name: "Mods",
			icon: "abc",
			unicode_emoji: undefined,
			info: {cdn: CDN},
		}) as InstanceType<typeof Role>;
		const icon = role.getIcon() as HTMLElement;
		const parent = mount(icon);
		try {
			icon.dispatchEvent(new Event("error"));

			expect(parent.querySelector("img")).toBeNull();
			expect(parent.querySelector(".roleIcon")).toBeNull();
		} finally {
			parent.remove();
		}
	});
});

describe("guild icon whose image is gone", () => {
	it("is replaced by its initials", () => {
		// A plain object, not a Guild: autoLink is off, so no client state is needed.
		const icon = Guild.generateGuildIcon(
			{id: "444", name: "Test Guild", icon: "abc", info: {cdn: CDN}},
			false,
		);
		const parent = mount(icon);
		try {
			parent.querySelector("img")?.dispatchEvent(new Event("error"));

			const blank = parent.querySelector<HTMLElement>(".blankserver");
			expect(blank).not.toBeNull();
			expect(blank?.textContent).toBe("TG");
			expect(parent.querySelector("img")).toBeNull();
		} finally {
			parent.remove();
		}
	});

	it("a Guild with autoLink off falls back to initials with no bindings, as its icon has", () => {
		const guild = Object.assign(Object.create(Guild.prototype), {
			id: "446",
			properties: {name: "Stub Guild", icon: "abc"},
			owner: {info: {cdn: CDN}},
		}) as InstanceType<typeof Guild>;
		const icon = Guild.generateGuildIcon(guild, false);
		const parent = mount(icon);
		try {
			parent.querySelector("img")?.dispatchEvent(new Event("error"));

			const blank = parent.querySelector<HTMLElement>(".blankserver");
			expect(blank).not.toBeNull();
			expect(blank?.onclick ?? null).toBeNull();
		} finally {
			parent.remove();
		}
	});

	it("a hostile guild name renders as initials text, never as markup", () => {
		const icon = Guild.generateGuildIcon(
			{id: "445", name: "<img src=x onerror=alert(1)>", icon: "abc", info: {cdn: CDN}},
			false,
		);
		const parent = mount(icon);
		try {
			parent.querySelector("img")?.dispatchEvent(new Event("error"));

			const blank = parent.querySelector<HTMLElement>(".blankserver");
			expect(blank).not.toBeNull();
			expect(blank?.querySelector("img") ?? null).toBeNull();
			expect(parent.querySelector("img")).toBeNull();
		} finally {
			parent.remove();
		}
	});
});
