import {expect, it, onTestFinished, vi} from "vitest";

await import("./localuser");
const {Embed} = await import("./embed");

const css = await (await fetch(new URL("./public/style.css", import.meta.url))).text();
document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);

type Args = ConstructorParameters<typeof Embed>;
type Field = {name: string; value: string; inline?: boolean};

/** Draws a rich embed in the page, as a message would, and hands back each field's box. */
function render(fields: Field[], extra: object = {}) {
	const owner = {
		channel: {guild: {localuser: {refreshIfNeeded: vi.fn(async (url: string) => url)}}},
	};
	const embed = new Embed(
		{type: "rich", fields, ...extra} as unknown as Args[0],
		owner as unknown as Args[1],
	);
	const html = embed.generateHTML();
	// The message column a card sits in.
	const column = document.createElement("div");
	column.style.width = "520px";
	column.append(html);
	document.body.append(column);
	onTestFinished(() => column.remove());
	return fields.map((field) => {
		const b = [...html.querySelectorAll("b")].find((el) => el.textContent === field.name)!;
		return b.parentElement!.getBoundingClientRect();
	});
}

it("draws up to three inline fields side by side, as Discord does", () => {
	const [a, b, c] = render([
		{name: "a", value: "1", inline: true},
		{name: "b", value: "2", inline: true},
		{name: "c", value: "3", inline: true},
	]);

	expect([b.top, c.top]).toEqual([a.top, a.top]);
	expect(a.right).toBeLessThanOrEqual(b.left);
	expect(b.right).toBeLessThanOrEqual(c.left);
});

it("starts a new row after the third inline field and for a field that isn't inline", () => {
	const [a, , , d, e, f] = render([
		{name: "a", value: "1", inline: true},
		{name: "b", value: "2", inline: true},
		{name: "c", value: "3", inline: true},
		{name: "d", value: "4", inline: true},
		{name: "e", value: "5"},
		{name: "f", value: "6", inline: true},
	]);

	expect(d.top).toBeGreaterThan(a.top);
	expect(d.left).toBe(a.left);
	expect(e.top).toBeGreaterThan(d.top);
	expect(f.top).toBeGreaterThan(e.top);
	// A field that isn't inline takes the whole row.
	expect(e.width).toBeGreaterThan(a.width * 2);
});

it("wraps a long unbroken word inside its field instead of spilling over the next", () => {
	const [a, b, c] = render([
		{name: "a", value: "x".repeat(300), inline: true},
		{name: "b", value: "2", inline: true},
		{name: "c", value: "3", inline: true},
	]);
	const grid = document.querySelector<HTMLElement>(".embedFields")!;

	expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth);
	expect([b.top, c.top]).toEqual([a.top, a.top]);
});

it("fits two inline fields to a row beside a thumbnail", () => {
	const [a, b, c] = render(
		[
			{name: "a", value: "1", inline: true},
			{name: "b", value: "2", inline: true},
			{name: "c", value: "3", inline: true},
		],
		{thumbnail: {url: "https://cdn.test/t.png", proxy_url: "https://cdn.test/t.png"}},
	);

	expect(b.top).toBe(a.top);
	expect(c.top).toBeGreaterThan(a.top);
});
