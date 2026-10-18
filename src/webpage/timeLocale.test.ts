import {afterEach, describe, expect, it, vi} from "vitest";

await import("./localuser");
const {I18n} = await import("./i18n");
const {MarkDown} = await import("./markdown");
await I18n.done;

describe("I18n.locale", () => {
	const initialLang = I18n.lang;

	afterEach(() => {
		I18n.lang = initialLang;
		vi.restoreAllMocks();
	});

	it("picks the browser's regional variant when it matches the app language, else the app language", () => {
		vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB", "fr-FR"]);

		I18n.lang = "en";
		expect(I18n.locale).toBe("en-GB");

		I18n.lang = "fr";
		expect(I18n.locale).toBe("fr-FR");

		I18n.lang = "es";
		expect(I18n.locale).toBe("es");
	});

	it("keeps the app language's script or region over another one of the same language", () => {
		vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN", "pt-PT", "zh-TW", "en"]);
		I18n.lang = "zh-hant";
		expect(I18n.locale).toBe("zh-TW");
		I18n.lang = "zh-hans";
		expect(I18n.locale).toBe("zh-CN");
		I18n.lang = "pt-br";
		expect(I18n.locale).toBe("pt-br");
	});

	it("formats <t:…:D> timestamps in the app language rather than the browser's", () => {
		vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
		I18n.lang = "es";

		const html = new MarkDown("<t:1760000000:D>", undefined).makeHTML();
		expect(html.querySelector(".markdown-timestamp")?.textContent).toBe(
			new Date(1760000000000).toLocaleString("es", {
				day: "numeric",
				month: "long",
				year: "numeric",
			}),
		);
	});
});
