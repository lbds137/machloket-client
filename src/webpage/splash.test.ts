import {afterEach, expect, it} from "vitest";
// @ts-expect-error Vite's ?raw import; its vite/client types aren't loaded here
import appHtml from "./app.html?raw";
// @ts-expect-error Vite's ?inline import returns the stylesheet text.
const {default: style} = await import("./public/style.css?inline");
// @ts-expect-error Vite's ?inline import returns the stylesheet text.
const {default: themes} = await import("./themes.css?inline");
// @ts-expect-error Vite's ?inline import returns the stylesheet text.
const {default: brand} = await import("./public/brand/brand.css?inline");
// @ts-expect-error Vite's ?inline import returns the stylesheet text.
const {default: devBrand} = await import("./public/brand/dev/brand.css?inline");

document.head.insertAdjacentHTML(
	"beforeend",
	`<style>${style}</style><style>${themes}</style><style>${brand}</style>`,
);

afterEach(() => {
	document.body.className = "";
	document.body.replaceChildren();
});

/** app.html's loading screen as served: what the splash shows before its code runs. */
function splash(): HTMLElement {
	const page = new DOMParser().parseFromString(appHtml as string, "text/html");
	return page.getElementById("loading")!;
}

const THEMES = [
	["Dark", "Dark-theme"],
	["no theme", "no-theme"],
	["WHITE", "WHITE-theme"],
	["Light", "Light-theme"],
	["Dark-Accent", "Dark-Accent-theme"],
	["Onyx", "Onyx-theme"],
	["Fuzzy", "Fuzzy-theme"],
] as const;

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

/** WCAG contrast of two `rgb(…)` strings. */
function contrast(a: string, b: string) {
	const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (l1 + 0.05) / (l2 + 0.05);
}

/** `color` composited over `bg` at `alpha` (a splash text's opacity), as an rgb string. */
function blend(color: string, bg: string, alpha: number) {
	const fg = color.match(/\d+(\.\d+)?/g)!.map(Number);
	const back = bg.match(/\d+(\.\d+)?/g)!.map(Number);
	const [r, g, b] = [0, 1, 2].map((i) => Math.round(fg[i] * alpha + back[i] * (1 - alpha)));
	return `rgb(${r}, ${g}, ${b})`;
}

/** The background a brand.css text pins, as an rgb string. */
function brandBg(cssText: string) {
	const hex = cssText.match(/--brand-bg:\s*(#[0-9a-f]{6})/)![1].toLowerCase();
	const n = parseInt(hex.slice(1), 16);
	return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

for (const [name, className] of THEMES) {
	it(`the splash reads on its brand-dark background in ${name}`, () => {
		document.body.className = className;
		document.body.append(splash());

		const loading = document.getElementById("loading")!;
		const desc = document.getElementById("load-desc")!;
		const switcher = document.getElementById("switchaccounts")!;
		const bg = getComputedStyle(loading).backgroundColor;
		// The dev server paints the same splash over its own darker brand; the same pair
		// must read there too, blended over that background, not this one.
		const devBg = brandBg(devBrand);
		const opacity = Number(getComputedStyle(desc).opacity);
		// The status line is 70% opaque; a reader sees it blended into the splash.
		const descColor = blend(getComputedStyle(desc).color, bg, opacity);
		const devDescColor = blend(getComputedStyle(desc).color, devBg, opacity);
		const switchColor = getComputedStyle(switcher).color;

		expect(contrast(descColor, bg), `status line on ${bg}`).toBeGreaterThanOrEqual(4.5);
		expect(contrast(switchColor, bg), `switch link on ${bg}`).toBeGreaterThanOrEqual(4.5);
		expect(contrast(devDescColor, devBg), `status line on dev ${devBg}`).toBeGreaterThanOrEqual(
			4.5,
		);
		expect(contrast(switchColor, devBg), `switch link on dev ${devBg}`).toBeGreaterThanOrEqual(4.5);
		// The app-wide button fill stays off the splash link in every theme.
		expect(getComputedStyle(switcher).backgroundColor).toBe("rgba(0, 0, 0, 0)");
	});
}

it("a dismissed splash leaves nothing focusable in it", () => {
	document.body.append(splash());
	const loading = document.getElementById("loading")!;
	loading.classList.add("doneloading");

	const switcher = document.getElementById("switchaccounts")!;
	switcher.focus();
	expect(document.activeElement).toBe(document.body);
});

it("both brand palettes pin the splash colours alike", () => {
	const pick = (cssText: string, name: string) =>
		cssText.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`))?.[1]?.toLowerCase();
	// The text and link pair is shared, so one measured cascade covers both brands; each
	// background is that brand's own art and may differ, but both must be pinned.
	for (const v of ["--brand-text", "--brand-link"]) {
		const prod = pick(brand, v);
		expect(prod, `${v} in the production palette`).toBeDefined();
		expect(pick(devBrand, v), `${v} in the dev palette`).toBe(prod);
	}
	for (const [file, cssText] of [
		["production", brand],
		["dev", devBrand],
	] as const) {
		expect(pick(cssText, "--brand-bg"), `--brand-bg in the ${file} palette`).toBeDefined();
	}
});

it("the switch-accounts affordance is a real button, so keyboards reach it (TASK-186)", () => {
	document.body.append(splash());
	const switcher = document.getElementById("switchaccounts")!;

	expect(switcher.tagName).toBe("BUTTON");
	expect((switcher as HTMLButtonElement).type).toBe("button");
	// The underline carries the link affordance without the colour.
	expect(getComputedStyle(switcher).textDecorationLine).toContain("underline");

	switcher.focus();
	expect(document.activeElement).toBe(switcher);
});

it("the Retry button's description is the status line above it", () => {
	const el = splash().querySelector("#gatewayRetry")!;

	expect(el.getAttribute("aria-describedby")).toBe("load-desc");
	expect(el.closest("#loading")!.querySelector("#load-desc")).toBeTruthy();
});
