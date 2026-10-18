import {afterEach, describe, expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {I18n} = await import("./i18n");
await I18n.done;
const {File} = await import("./file");
const {MarkDown} = await import("./markdown");
const {Embed} = await import("./embed");
const {Message} = await import("./message");

afterEach(() => {
	vi.restoreAllMocks();
});

describe("render strings routed through I18n", () => {
	it("formats File.filesizehuman(1536) with Intl.NumberFormat in I18n.locale and routes the card label through I18n.file.size", () => {
		const expected = new Intl.NumberFormat(I18n.locale, {
			style: "unit",
			unit: "kilobyte",
			unitDisplay: "short",
			maximumFractionDigits: 2,
		}).format(1.5);
		expect(File.filesizehuman(1536)).toBe(expected);

		const card = new File(
			{
				id: "1",
				filename: "doc.bin",
				content_type: "application/octet-stream",
				size: 1536,
				url: "https://cdn.test/doc.bin",
			} as never,
			null,
		).createunknown();
		expect(card.querySelector(".filesize")?.textContent).toBe(I18n.file.size(expected));
	});

	it("clamps File.filesizehuman(2 ** 60) at terabytes so it never contains undefined", () => {
		const unit = (u: string, display: "long" | "short", n: number) =>
			new Intl.NumberFormat(I18n.locale, {style: "unit", unit: u, unitDisplay: display}).format(n);
		expect(File.filesizehuman(2 ** 60)).toBe(unit("terabyte", "short", 1024 ** 2));
		expect(File.filesizehuman(500)).toBe(unit("byte", "long", 500));
		expect(File.filesizehuman(1024)).toBe(unit("kilobyte", "short", 1));
	});

	it("shows a missing, negative or fractional size instead of throwing", () => {
		const zero = File.filesizehuman(0);
		for (const odd of [NaN, -1, undefined as unknown as number]) {
			expect(File.filesizehuman(odd)).toBe(zero);
		}
		expect(File.filesizehuman(0.5)).toBe(
			new Intl.NumberFormat(I18n.locale, {style: "unit", unit: "byte", unitDisplay: "long"}).format(
				0.5,
			),
		);
	});

	it("routes an unknown <#id> channel mention through I18n.channelping.unknown", () => {
		const owner = {user: {id: "me"}, channelids: new Map()} as never;
		expect(new MarkDown("<#123>", owner).makeHTML().textContent).toContain(
			I18n.channelping.unknown(),
		);

		vi.spyOn(I18n.channelping, "unknown").mockReturnValue("#desconocido");
		expect(new MarkDown("<#123>", owner).makeHTML().textContent).toContain("#desconocido");
	});

	it("routes invite card member count through I18n.invite.members with I18n.locale and omits it when undefined", () => {
		const localuser = {info: {api: "http://invite.test/api/v9"}, guildids: new Map()};
		const renderSubtext = (member_count?: number) => {
			const embed = new Embed(
				{type: "invite", invite: {url: "http://invite.test", code: "abc"}} as never,
				{channel: {guild: {localuser}}} as never,
			);
			embed.invcache = [
				{
					code: "abc",
					guild: {id: "700", name: "Guild", member_count, icon: null, banner: null},
					channel: {name: "general"},
				} as never,
				{cdn: "http://invite.test/cdn", api: "http://invite.test/api/v9"},
			];
			return embed.generateHTML().querySelector(".subtext")?.textContent;
		};

		const formattedCount = (1234).toLocaleString(I18n.locale);
		expect(renderSubtext(1234)).toBe("#general • " + I18n.invite.members(formattedCount));

		vi.spyOn(I18n.invite, "members").mockImplementation((c) => `Miembros: ${c}`);
		expect(renderSubtext(1234)).toBe(`#general • Miembros: ${formattedCount}`);

		expect(renderSubtext(undefined)).toBe("#general");
	});

	it("routes a reply to a blocked user through I18n.friends.bu", async () => {
		vi.spyOn(I18n.friends, "bu").mockReturnValue("Usuario bloqueado");
		const msg = Object.assign(Object.create(Message.prototype), {
			id: "500",
			type: 99,
			flags: 0,
			timestamp: new Date(0).toISOString(),
			author: {relationshipType: 0},
			attachments: [],
			stickers: [],
			message_reference: {message_id: "400", type: 0},
			owner: {
				guild: {member: null},
				localuser: {user: {id: "me"}},
				getmessage: async () => ({author: {relationshipType: 2}}),
			},
		}) as InstanceType<typeof Message>;

		const div = document.createElement("div");
		msg.generateMessage(undefined, false, div);
		await vi.waitFor(() => {
			expect(div.querySelector(".replyflex .username")?.textContent).toBe("Usuario bloqueado");
		});
	});
});
