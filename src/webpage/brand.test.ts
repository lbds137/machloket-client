import {describe, expect, it} from "vitest";
import {APP_NAME} from "./brand";

// Tests run on a Vite dev server, so they see what the owner's phone sees from the dev server:
// the Machlakot brand (ember palette), never the production Machloket one.
const DEV_EMBER = "#E0452C";
const PROD_VIOLET = "#6C4BD8";

describe("dev server branding", () => {
	it("names the app Machlakot", () => {
		expect(APP_NAME).toBe("Machlakot");
	});

	it("serves a Machlakot manifest whose icons all load", async () => {
		const res = await fetch("/manifest.json");
		expect(res.ok).toBe(true);
		const manifest = await res.json();
		expect(manifest.name).toBe("Machlakot");
		expect(manifest.short_name).toBe("Machlakot");
		expect(manifest.id).toBe("/app");
		const purposes = new Set<string>();
		for (const icon of manifest.icons) {
			const iconRes = await fetch(icon.src);
			expect(iconRes.ok, icon.src).toBe(true);
			expect(iconRes.headers.get("content-type"), icon.src).toBe(icon.type);
			purposes.add(icon.purpose);
		}
		expect([...purposes].sort()).toEqual(["any", "maskable"]);
	});

	it("answers the production icon URLs with the dev artwork", async () => {
		const svg = await (await fetch("/brand/icon.svg")).text();
		expect(svg).toContain(DEV_EMBER);
		expect(svg).not.toContain(PROD_VIOLET);

		const favicon = new Uint8Array(await (await fetch("/favicon.ico")).arrayBuffer());
		const devFavicon = new Uint8Array(await (await fetch("/brand/dev/favicon.ico")).arrayBuffer());
		expect(favicon.length).toBeGreaterThan(0);
		expect(favicon).toEqual(devFavicon);
	});
});
