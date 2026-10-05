import {expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Localuser} = await import("./localuser");
const {User} = await import("./user");
const {cssUrl} = await import("./utils/netUtils");

it("a Steam link keeps the account id inside its path segment", () => {
	const link = User.getLink({type: "steam", external_id: "../../groups/x?y"} as never)!;

	expect(new URL(link).pathname).toBe("/profiles/..%2F..%2Fgroups%2Fx%3Fy");
});

it("an icon URL can't close the CSS url() it is placed in", () => {
	const span = document.createElement("span");
	const hostile = 'https://cdn.test/a.svg"), url("https://tracker.test/b.png';

	span.style.setProperty("mask-image", cssUrl(hostile));
	document.body.append(span);

	// One image layer, holding the whole string (a second layer would be a second request).
	const layers = getComputedStyle(span).maskImage;
	span.remove();
	expect(layers.match(/url\("/g)).toHaveLength(1);
	expect(layers).toContain("tracker.test");
});

it("an ordinary icon URL is unchanged", () => {
	const span = document.createElement("span");
	span.style.setProperty("mask-image", cssUrl("https://cdn.test/steam.svg"));

	expect(span.style.getPropertyValue("mask-image")).toBe('url("https://cdn.test/steam.svg")');
});

it("a server banner name can't add a second background image", () => {
	const name = document.createElement("div");
	name.id = "serverName";
	const banner = document.createElement("div");
	banner.id = "servertd";
	document.body.append(name, banner);
	const guild = {
		id: "g1",
		banner: "b1),url(https://tracker.test/c.png",
		properties: {name: "G"},
	};
	const me = Object.assign(Object.create(Localuser.prototype), {
		info: {cdn: "http://cdn.test"},
		guildids: new Map([["g1", guild]]),
	}) as InstanceType<typeof Localuser>;

	try {
		me.loadGuild("g1");
	} catch {
		// The rest of the guild switch needs a whole account; the banner is set before it.
	}
	const layers = getComputedStyle(banner).backgroundImage;
	name.remove();
	banner.remove();

	expect(layers.match(/url\("/g)).toHaveLength(1);
});
