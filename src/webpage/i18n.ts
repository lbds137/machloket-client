//@ts-ignore
import {langs} from "./translations/langs.js";
const langmap = new Map<string, string>();
for (const lang of Object.keys(langs) as string[]) {
	langmap.set(lang, langs[lang]);
}
console.log(langs);
type translation = {
	[key: string]: string | translation;
};
let res: () => unknown = () => {};
/** Languages whose 3+-alternative PLURAL blocks are written one|few|many (checked against the
 * shipped cs, pl and ru files); add one only after reading its blocks. */
const CATEGORY_PLURAL_LANGS = new Set(["cs", "pl", "ru"]);
/** Regions whose browsers write a script's language without naming the script (zh-TW, not zh-Hant-TW). */
const SCRIPT_REGIONS: Record<string, string[]> = {
	hans: ["cn", "sg", "my"],
	hant: ["tw", "hk", "mo"],
};
class I18n {
	static lang: string;
	/** The locale for dates and numbers: the browser's own regional variant of the app's
	 * language when it lists one (en-GB for "en"), else the app's language itself. A
	 * translation for one script or region ("zh-hant", "pt-br") only takes a variant of it. */
	static get locale(): string {
		const lang = I18n.lang || "en";
		const [base, sub] = lang.toLowerCase().split("-");
		const fits = (tag: string) => {
			const parts = tag.toLowerCase().split("-");
			if (parts[0] !== base) return false;
			if (!sub) return true;
			return parts.includes(sub) || !!SCRIPT_REGIONS[sub]?.some((r) => parts.includes(r));
		};
		return navigator.languages.find(fits) ?? lang;
	}
	static translations: translation[] = [];
	static done = new Promise<void>((res2, _reject) => {
		res = res2;
	});
	static async create(lang: string) {
		if (!(lang + ".json" in langs)) {
			if (lang.includes("-")) lang = lang.split("-")[0];
			if (!(lang + ".json" in langs)) {
				console.warn("Language " + lang + " not found, defaulting to en");
				lang = "en";
			}
		}

		// English ships in the bundle, so a failed fetch (offline cold start, a deploy mid-update)
		// falls back to it instead of leaving `done` pending and the app blank.
		const en = bundledEn as unknown as translation;
		const translations: translation[] = [];
		if (lang !== "en") {
			try {
				const answer = await fetch(new URL(`./translations/${lang}.json`, import.meta.url).href);
				if (!answer.ok) throw new Error(`${answer.status}`);
				translations.push((await answer.json()) as translation);
			} catch (e) {
				console.error(`Couldn't load the ${lang} translation, using English:`, e);
				lang = "en";
			}
		}
		translations.push(en);
		Object.assign(this, transForm(en));
		this.lang = lang;
		this.translations = translations;

		res();
	}
	static translatePage() {
		const elms = document.querySelectorAll("[i18n]");
		for (const elm of Array.from(elms)) {
			const t = elm.getAttribute("i18n") as string;
			try {
				elm.textContent = this.getTranslation(t);
			} catch {
				console.error("Couldn't get " + t + "'s translation");
			}
		}
	}
	static getTranslation(msg: string, ...params: string[]): string {
		let str: string | undefined;
		const path = msg.split(".");
		for (const json of this.translations) {
			let jsont: string | translation = json;
			for (const thing of path) {
				if (typeof jsont !== "string" && jsont !== undefined) {
					jsont = jsont[thing];
				} else {
					jsont = json;
					break;
				}
			}

			if (typeof jsont === "string") {
				str = jsont;
				break;
			}
		}
		if (str) {
			return this.fillInBlanks(str, params);
		} else {
			throw new Error(msg + " not found");
		}
	}
	/** Intl's plural category for `numb` in the active language (CLDR rules, so e.g. Czech's
 * "few" is only 2-4 while Polish's reaches 22). The PluralRules object is cached per
 * language. Only consulted for blocks with three or more alternatives, and only for the
 * languages in CATEGORY_PLURAL_LANGS, whose blocks are written one|few|many. */
	private static pluralRulesByLang = new Map<string, Intl.PluralRules>();
	private static pluralClass(numb: number): string {
		let rules = I18n.pluralRulesByLang.get(I18n.lang);
		if (!rules) {
			rules = new Intl.PluralRules(I18n.lang);
			I18n.pluralRulesByLang.set(I18n.lang, rules);
		}
		return rules.select(numb);
	}
	static fillInBlanks(msg: string, params: string[]): string {
		msg = msg.replace(/(\$\d+)|({{(.+?)}})/g, (_, dolar, str, match) => {
			if (dolar) {
				const number = Number(dolar.slice(1));
				if (params[number - 1] !== undefined) {
					return params[number - 1];
				} else {
					return dolar;
				}
			} else {
				const [op, strsSplit] = this.fillInBlanks(match, params).split(":");
				const [first, ...strs] = strsSplit.split("|");
				switch (op.toUpperCase()) {
					case "PLURAL": {
						const numb = Number(first);
						if (numb === 0) {
							return strs[strs.length - 1];
						}
						// A block with three or more alternatives can carry a language's middle plural
						// classes (Czech: 1 / 2-4 / the rest, 12-14 included). Only the languages whose
						// shipped blocks are written one|few|many select by category; any other (ga's
						// blocks use named forms), and every shorter block, keeps the positional mapping.
						if (strs.length > 2 && CATEGORY_PLURAL_LANGS.has(I18n.lang)) {
							const cls = this.pluralClass(numb);
							if (cls === "one") return strs[0];
							if (cls === "few") return strs[1];
							return strs[2];
						}
						return strs[Math.min(strs.length - 1, numb - 1)];
					}
					case "GENDER": {
						if (first === "male") {
							return strs[0];
						} else if (first === "female") {
							return strs[1];
						} else if (first === "neutral") {
							if (strs[2]) {
								return strs[2];
							} else {
								return strs[0];
							}
						}
					}
				}
				return str;
			}
		});
		return msg;
	}
	static options() {
		return [...langmap.keys()].map((e) => e.replace(".json", ""));
	}
	static setLanguage(lang: string) {
		if (this.options().indexOf(lang) !== -1) {
			getPreferences().then(async (prefs) => {
				prefs.locale = lang;
				await I18n.create(lang);
				await setPreferences(prefs);
			});
		}
	}
}
console.log(langmap);
let userLocale = navigator.language.slice(0, 2) || "en";
if (I18n.options().indexOf(userLocale) === -1) {
	userLocale = "en";
}
const prefs = await getPreferences();
const storage = prefs.locale;
if (storage) {
	userLocale = storage;
} else {
	prefs.locale = userLocale;
	await setPreferences(prefs);
}
I18n.create(userLocale);
function transForm(inobj: translation, path: string = "") {
	const obj: Record<string, any> = {};
	for (const [key, value] of Object.entries(inobj)) {
		if (typeof value === "string") {
			obj[key] = (...args: string[]) => {
				return I18n.getTranslation((path ? path + "." : path) + key, ...args);
			};
		} else {
			obj[key] = transForm(value, (path ? path + "." : path) + key);
		}
	}
	return obj;
}

import bundledEn from "./../../translations/en.json";
import {getPreferences, setPreferences} from "./utils/storage/userPreferences";
type beforeType = typeof bundledEn;

type DoTheThing<T> = {
	[K in keyof T]: T[K] extends string ? (...args: string[]) => string : DoTheThing<T[K]>;
};

const cast = I18n as unknown as typeof I18n & DoTheThing<beforeType>;
export {cast as I18n, langmap};
