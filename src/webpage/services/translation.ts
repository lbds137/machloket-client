import type {Channel} from "../channel.js";
import {I18n} from "../i18n.js";
import {MarkDown} from "../markdown.js";
import {Dialog} from "../settings.js";
import {getPreferences, setPreferences} from "../utils/storage/userPreferences.js";
import {
	hasTranslatableContent,
	isCodeOnlyMessage,
	prepareTextForTranslation,
} from "../utils/translationText.js";
import {
	hasTranslationConsent,
	isExternalFeaturesEnabled,
	promptSovrahiAuth,
	setTranslationConsent,
	type SovrahiAuthContext,
	SovrahiRequiresKeycloakError,
	SovrahiService,
} from "./sovrahi.js";

const LANGUAGES_ENDPOINT = "https://translate.sovrahi.com/languages";

type LanguagesResponse = {
	success: boolean;
	languages: string[];
	pairs?: Array<{from: string; to: string}>;
	cached_at?: string;
};

export type TranslateLanguage = {
	code: string;
	name: string;
};

let languagesCache: TranslateLanguage[] | null = null;
let languagesPromise: Promise<TranslateLanguage[]> | null = null;
let activeTranslationLang: string | undefined;

function formatLanguageName(code: string): string {
	try {
		const label = new Intl.DisplayNames([code], {type: "language"}).of(code);
		if (label) return label;
	} catch {
		// fall through
	}
	try {
		const base = code.split("-")[0];
		const label = new Intl.DisplayNames([base], {type: "language"}).of(code);
		if (label) return label;
	} catch {
		// fall through
	}
	return code;
}

void getPreferences().then((prefs) => {
	activeTranslationLang = prefs.translationLang;
});

export type TranslationOutcome = {
	text: string;
	sourceLang: string;
	codeOnly: boolean;
	fromCache: boolean;
};

export type TranslationItem = {
	id: string;
	raw: string;
};

export type TranslationErrorContext = {
	channel?: Channel;
	messageId?: string;
	silent?: boolean;
	onAuthRequired?: (context?: SovrahiAuthContext) => void;
	onBlocked?: () => void;
};

export async function getTranslateLanguages(): Promise<TranslateLanguage[]> {
	if (languagesCache) return languagesCache;
	if (languagesPromise) return languagesPromise;
	languagesPromise = fetch(LANGUAGES_ENDPOINT)
		.then(async (response) => {
			if (!response.ok) throw new Error("Failed to fetch languages");
			const json = (await response.json()) as LanguagesResponse;
			if (!json.success || !json.languages?.length) {
				throw new Error("Invalid languages response");
			}
			const languages = json.languages
				.map((code) => ({code, name: formatLanguageName(code)}))
				.sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: "base"}));
			languagesCache = languages;
			return languages;
		})
		.catch(() => {
			const fallback = ["ar", "de", "en", "es", "fr", "it", "ja", "pt", "ru", "zh-Hans", "zh-Hant"];
			const languages = fallback
				.map((code) => ({code, name: formatLanguageName(code)}))
				.sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: "base"}));
			languagesCache = languages;
			return languages;
		})
		.finally(() => {
			languagesPromise = null;
		});
	return languagesPromise;
}

export function getActiveTranslationLang(): string | undefined {
	return activeTranslationLang;
}

export async function getTranslationLang(): Promise<string | undefined> {
	const prefs = await getPreferences();
	activeTranslationLang = prefs.translationLang;
	return prefs.translationLang;
}

export async function setTranslationLang(lang: string): Promise<void> {
	const prefs = await getPreferences();
	prefs.translationLang = lang;
	activeTranslationLang = lang;
	await setPreferences(prefs);
}

export async function resolveTranslationTargetLang(): Promise<string | null> {
	const configured = await getTranslationLang();
	if (configured) return configured;
	return ensureTranslationLangConfigured();
}

export async function getTypingTranslationLang(): Promise<string | undefined> {
	const prefs = await getPreferences();
	return prefs.typingTranslationLang;
}

export async function setTypingTranslationLang(lang: string): Promise<void> {
	const prefs = await getPreferences();
	prefs.typingTranslationLang = lang;
	await setPreferences(prefs);
}

export function showConsentDialog(): Promise<boolean> {
	return new Promise((resolve) => {
		if (hasTranslationConsent()) {
			resolve(true);
			return;
		}
		const dialog = new Dialog(I18n.translation.confirmTitle(), {noSubmit: true});
		const body = document.createElement("p");
		body.style.whiteSpace = "pre-line";
		body.textContent = I18n.translation.confirmText();
		dialog.options.addHTMLArea(body);
		dialog.options.addButtonInput("", I18n.translation.agree(), () => {
			setTranslationConsent();
			dialog.hide();
			resolve(true);
		});
		dialog.options.addButtonInput("", I18n.translation.cancel(), () => {
			dialog.hide();
			resolve(false);
		});
		dialog.show();
	});
}

export function showLanguagePickerDialog(
	title: string,
	{defaultCode, confirmLabel}: {defaultCode?: string; confirmLabel?: string} = {},
): Promise<string | null> {
	return new Promise((resolve) => {
		void getTranslateLanguages().then((languages) => {
			const dialog = new Dialog(title, {noSubmit: true});
			const names = languages.map((lang) => lang.name);
			let selectedIndex = 0;
			if (defaultCode) {
				const index = languages.findIndex((lang) => lang.code === defaultCode);
				if (index !== -1) selectedIndex = index;
			}
			const select = dialog.options.addSelect(I18n.translation.targetLanguage(), () => {}, names, {
				defaultIndex: selectedIndex,
			});
			select.watchForChange((index) => {
				selectedIndex = index;
			});
			dialog.options.addButtonInput("", confirmLabel || I18n.translation.confirmLanguage(), () => {
				dialog.hide();
				resolve(languages[select.index]?.code || null);
			});
			dialog.options.addButtonInput("", I18n.translation.cancel(), () => {
				dialog.hide();
				resolve(null);
			});
			dialog.show();
		});
	});
}

export async function ensureTranslationLangConfigured(): Promise<string | null> {
	const existing = await getTranslationLang();
	if (existing) return existing;

	const consented = await showConsentDialog();
	if (!consented) return null;

	const picked = await showLanguagePickerDialog(I18n.translation.chooseLanguageTitle());
	if (!picked) return null;

	await setTranslationLang(picked);
	return picked;
}

export function buildAuthContext(
	channel?: Channel,
	messageId?: string,
): SovrahiAuthContext | undefined {
	if (!channel) return undefined;
	return {
		guildId: channel.guild.id,
		channelId: channel.id,
		messageId: messageId || channel.lastmessageid || "0",
	};
}

export function handleTranslationError(
	error: unknown,
	context: TranslationErrorContext = {},
): boolean {
	if (error instanceof SovrahiRequiresKeycloakError) {
		if (context.onAuthRequired) {
			context.onAuthRequired(buildAuthContext(context.channel, context.messageId));
		} else {
			promptSovrahiAuth(buildAuthContext(context.channel, context.messageId));
		}
		return true;
	}

	context.onBlocked?.();

	if (!context.silent) {
		const message = error instanceof Error ? error.message : I18n.translation.errorUnexpected();
		alert(message);
	}
	return false;
}

export class TranslationService {
	static canTranslateContent(raw: string | undefined): boolean {
		return !!raw?.trim() && isExternalFeaturesEnabled();
	}

	static isCodeOnly(raw: string): boolean {
		return isCodeOnlyMessage(raw);
	}

	static codeOnlyOutcome(raw: string): TranslationOutcome {
		return {text: raw, sourceLang: "auto", codeOnly: true, fromCache: false};
	}

	static async translateContent(
		raw: string,
		targetLang: string,
		{cacheId, skipCache = false}: {cacheId?: string; skipCache?: boolean} = {},
	): Promise<TranslationOutcome> {
		if (isCodeOnlyMessage(raw)) {
			return this.codeOnlyOutcome(raw);
		}

		const prepared = prepareTextForTranslation(raw);

		if (cacheId && !skipCache) {
			const cached = SovrahiService.getCachedTranslation(cacheId, targetLang, raw);
			if (cached) {
				return {
					text: cached.text,
					sourceLang: cached.sourceLang,
					codeOnly: false,
					fromCache: true,
				};
			}
		}

		const result = cacheId
			? await SovrahiService.translateMessage(cacheId, {
					text: prepared.text,
					targetLang,
					sourceText: raw,
				})
			: await SovrahiService.translateText(prepared.text, targetLang);

		const restored = prepared.restore(result.text);

		if (cacheId && !skipCache) {
			SovrahiService.cacheTranslation(cacheId, targetLang, restored, result.sourceLang, raw);
		}

		return {
			text: restored,
			sourceLang: result.sourceLang,
			codeOnly: false,
			fromCache: result.fromCache,
		};
	}

	static async translateBatch(
		items: TranslationItem[],
		targetLang: string,
	): Promise<Map<string, TranslationOutcome>> {
		const outcomes = new Map<string, TranslationOutcome>();

		for (const item of items) {
			if (isCodeOnlyMessage(item.raw)) {
				outcomes.set(item.id, this.codeOnlyOutcome(item.raw));
			}
		}

		const preparedItems = items
			.filter((item) => !isCodeOnlyMessage(item.raw))
			.map((item) => {
				const prepared = prepareTextForTranslation(item.raw);
				return {
					id: item.id,
					raw: item.raw,
					text: prepared.text,
					restore: prepared.restore,
				};
			})
			.filter((item) => hasTranslatableContent(item.raw));

		if (!preparedItems.length) return outcomes;

		const subBatches = SovrahiService.buildTranslationBatches(
			preparedItems.map((item) => ({
				messageId: item.id,
				text: item.text,
				sourceText: item.raw,
			})),
		);

		const restoreById = new Map(preparedItems.map((item) => [item.id, item.restore] as const));

		for (const subBatch of subBatches) {
			const results = await SovrahiService.translateMessagesBatch(subBatch, targetLang);
			for (const result of results) {
				const restore = restoreById.get(result.messageId);
				const restored = restore ? restore(result.text) : result.text;
				const sourceText = preparedItems.find((item) => item.id === result.messageId)?.raw;
				if (sourceText) {
					SovrahiService.cacheTranslation(
						result.messageId,
						targetLang,
						restored,
						result.sourceLang,
						sourceText,
					);
				}
				outcomes.set(result.messageId, {
					text: restored,
					sourceLang: result.sourceLang,
					codeOnly: false,
					fromCache: false,
				});
			}
		}

		return outcomes;
	}

	static async translateTypingBox(channel: Channel | undefined): Promise<void> {
		if (!isExternalFeaturesEnabled() || !channel) return;

		const typebox = document.getElementById("typebox") as HTMLDivElement & {markdown: MarkDown};
		const original = MarkDown.gatherBoxText(typebox).trim();
		if (!original) return;

		const consented = await showConsentDialog();
		if (!consented) return;

		const defaultLang =
			(await getTypingTranslationLang()) || (await getTranslationLang()) || I18n.lang;
		const targetLang = await showLanguagePickerDialog(I18n.translation.translateTypingTitle(), {
			defaultCode: defaultLang,
			confirmLabel: I18n.translation.translate(),
		});
		if (!targetLang) return;

		await setTypingTranslationLang(targetLang);

		try {
			const outcome = await this.translateContent(original, targetLang, {skipCache: true});
			const display = isCodeOnlyMessage(original)
				? original
				: I18n.translation.typingResult(outcome.text, original);
			typebox.textContent = display;
			typebox.markdown.txt = display.split("");
			typebox.markdown.boxupdate(Infinity);
			channel.textSave = display;
		} catch (error) {
			handleTranslationError(error, {
				channel,
				onAuthRequired: (ctx) => promptSovrahiAuth(ctx),
			});
		}
	}
}
