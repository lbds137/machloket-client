import {afterEach, expect, it} from "vitest";

await import("./localuser");
const {MarkDown} = await import("./markdown");

// @ts-expect-error Vite's ?inline import returns the stylesheet text.
const {default: style} = await import("./public/style.css?inline");
// @ts-expect-error Vite's ?inline import returns the stylesheet text.
const {default: themes} = await import("./themes.css?inline");
document.head.insertAdjacentHTML("beforeend", `<style>${style}</style><style>${themes}</style>`);

afterEach(() => {
	document.body.className = "";
	document.body.replaceChildren();
});

/** Draws message text the way a message does, on a page in `theme`. */
function render(text: string, theme: string) {
	document.body.className = theme + "-theme";
	const html = new MarkDown(text).makeHTML();
	document.body.append(html);
	return html;
}

/** The theme's own value for a colour variable, as the browser resolves it. */
function themeColor(name: string) {
	const probe = document.createElement("span");
	probe.style.color = `var(${name})`;
	document.body.append(probe);
	const color = getComputedStyle(probe).color;
	probe.remove();
	return color;
}

/** WCAG relative luminance of an `rgb(…)` string. */
function luminance(rgb: string) {
	const [r, g, b] = rgb
		.match(/\d+(\.\d+)?/g)!
		.slice(0, 3)
		.map((v) => {
			const c = Number(v) / 255;
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

for (const theme of ["Onyx", "Fuzzy"]) {
	it(`a hidden spoiler shows as a bar you can see on ${theme}`, () => {
		const spoiler = render("before ||secret|| after", theme).querySelector(".spoiler")!;
		const bar = getComputedStyle(spoiler).backgroundColor;
		const page = themeColor("--primary-bg");

		// Discord's hidden spoiler is a solid grey bar, clearly lighter than the page.
		expect(luminance(bar) - luminance(page)).toBeGreaterThan(0.04);
		// …and the words stay hidden in it.
		expect(getComputedStyle(spoiler).color).toBe(bar);
	});
}

it("subtext inside a hidden spoiler stays hidden", () => {
	const spoiler = render("||-# secret||", "Onyx").querySelector(".spoiler")!;
	const small = spoiler.querySelector(".subtext")!;

	expect(getComputedStyle(small).color).toBe(getComputedStyle(spoiler).backgroundColor);
});

it("subtext reads quieter than the body text, and its links keep the link colour", () => {
	const html = render("body\n-# Model: [free](https://example.com/free)", "Onyx");
	const small = html.querySelector("small")!;

	expect(getComputedStyle(small).color).toBe(themeColor("--primary-text-soft"));
	expect(getComputedStyle(small.querySelector("a")!).color).toBe(themeColor("--link"));
});
