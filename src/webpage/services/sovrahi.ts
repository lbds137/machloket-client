import {I18n} from "../i18n.js";
import {Dialog} from "../settings.js";
import {getLocalSettings} from "../utils/storage/localSettings.js";
import {solveCapChallenge} from "./cap.js";

const AUTH_REALM = "https://auth.sovrahi.com/realms/so";
const AUTH_ENDPOINT = `${AUTH_REALM}/protocol/openid-connect/auth`;
const TOKEN_ENDPOINT = `${AUTH_REALM}/protocol/openid-connect/token`;
const TRANSLATE_ENDPOINT = "https://translate.sovrahi.com/translate";
const CLIENT_ID = "fermo";

const AUTH_STORAGE_KEY = "sovrahiAuth";
const TRANSLATION_CACHE_KEY = "sovrahiTranslationCache";
const PKCE_VERIFIER_KEY = "sovrahiPkceVerifier";
const PENDING_TRANSLATE_KEY = "sovrahiPendingTranslateMessageId";
const AUTH_REDIRECT_URI_KEY = "sovrahiAuthRedirectUri";
const TRANSLATION_CONSENT_KEY = "sovrahiTranslationConsent";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_UPSTREAM_RETRIES = 3;

type StoredAuth = {
	accessToken: string;
	refreshToken?: string;
	expiresAt: number;
};

type CachedTranslation = {
	text: string;
	sourceLang: string;
	targetLang: string;
	sourceText: string;
	cachedAt: number;
	hidden?: boolean;
};

type TranslateRequest = {
	text: string;
	targetLang: string;
	sourceText?: string;
	capToken?: string;
};

type TranslateResult = {
	text: string;
	sourceLang: string;
	fromCache: boolean;
};

type RateLimitedResponse = {
	error: "rate_limited";
	cap_api_endpoint?: string;
	cap_endpoint?: string;
	cap_required?: boolean;
	message?: string;
	instructions?: string;
	requires_keycloak?: boolean;
};

function requiresKeycloakAuth(json: {requires_keycloak?: boolean}): boolean {
	return json.requires_keycloak === true;
}

function getCapEndpoint(json: RateLimitedResponse): string | undefined {
	return json.cap_endpoint;
}

export type BatchTranslateItem = {
	messageId: string;
	text: string;
	sourceText?: string;
};

export type BatchTranslateResultItem = {
	messageId: string;
	text: string;
	sourceLang: string;
};

type AbuseResponse = {
	requires_keycloak?: boolean;
	message?: string;
};

export class SovrahiRequiresKeycloakError extends Error {
	constructor() {
		super(I18n.translation.authRequiredText());
		this.name = "SovrahiRequiresKeycloakError";
	}
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateCodeVerifier(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return base64UrlEncode(bytes);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return base64UrlEncode(new Uint8Array(digest));
}

function buildMessageRedirectUri(guildId: string, channelId: string, messageId: string): string {
	return `${window.location.origin}/channels/${guildId}/${channelId}/${messageId}`;
}

function getRedirectUri(): string {
	const stored = sessionStorage.getItem(AUTH_REDIRECT_URI_KEY);
	if (stored) return stored;

	const url = new URL(window.location.href);
	for (const key of ["code", "session_state", "state", "iss", "translateMessageId"]) {
		url.searchParams.delete(key);
	}
	return url.origin + url.pathname + url.search;
}

function cleanOAuthParamsFromUrl(): void {
	const params = new URLSearchParams(window.location.search);
	let changed = false;
	for (const key of ["code", "session_state", "state", "iss", "translateMessageId"]) {
		if (params.has(key)) {
			params.delete(key);
			changed = true;
		}
	}
	if (!changed) return;
	const cleaned = params.toString();
	history.replaceState(
		history.state,
		"",
		window.location.pathname + (cleaned ? `?${cleaned}` : ""),
	);
}

function readAuth(): StoredAuth | null {
	try {
		const raw = localStorage.getItem(AUTH_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as StoredAuth;
		if (!parsed.accessToken || !parsed.expiresAt) return null;
		return parsed;
	} catch {
		return null;
	}
}

function writeAuth(auth: StoredAuth): void {
	localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

function clearAuth(): void {
	localStorage.removeItem(AUTH_STORAGE_KEY);
}

function readTranslationCache(): Record<string, CachedTranslation> {
	try {
		return JSON.parse(localStorage.getItem(TRANSLATION_CACHE_KEY) || "{}") as Record<
			string,
			CachedTranslation
		>;
	} catch {
		return {};
	}
}

function writeTranslationCache(cache: Record<string, CachedTranslation>): void {
	localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(cache));
}

function cacheKey(messageId: string, targetLang: string): string {
	return `${messageId}:${targetLang}`;
}

function parseJwtExpiry(token: string): number {
	try {
		const payload = token.split(".")[1];
		if (!payload) return Date.now() + 5 * 60 * 1000;
		const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
			exp?: number;
		};
		if (!decoded.exp) return Date.now() + 5 * 60 * 1000;
		return decoded.exp * 1000;
	} catch {
		return Date.now() + 5 * 60 * 1000;
	}
}

function extractSourceLang(entry: Record<string, unknown>): string {
	const detected = entry.detectedLanguage;
	if (detected && typeof detected === "object") {
		const lang = (detected as {language?: string}).language;
		if (typeof lang === "string") return lang;
	}
	const directSource = entry.detectedSourceLanguage ?? entry.source_language ?? entry.source;
	if (typeof directSource === "string") return directSource;
	return "auto";
}

function parseTranslationEntry(
	entry: Record<string, unknown>,
	fallbackText?: string,
): {text: string; sourceLang: string} {
	const text = entry.translatedText ?? entry.text ?? fallbackText;
	if (typeof text !== "string") {
		throw new Error(I18n.translation.errorUnexpected());
	}
	return {text, sourceLang: extractSourceLang(entry)};
}

function parseTranslateResponse(json: Record<string, unknown>): {text: string; sourceLang: string} {
	const batchTranslations = json.translations as Array<Record<string, unknown>> | undefined;
	if (batchTranslations?.length === 1) {
		return parseTranslationEntry(batchTranslations[0]);
	}

	const directText = json.translatedText ?? json.translation ?? json.text;
	if (typeof directText === "string") {
		return {text: directText, sourceLang: extractSourceLang(json)};
	}

	const data = json.data as Record<string, unknown> | undefined;
	const dataTranslations = data?.translations as Array<Record<string, unknown>> | undefined;
	if (dataTranslations?.[0]) {
		return parseTranslationEntry(dataTranslations[0]);
	}

	throw new Error(I18n.translation.errorUnexpected());
}

function parseBatchTranslateResponse(
	json: Record<string, unknown>,
	count: number,
	sourceTexts?: string[],
): Array<{text: string; sourceLang: string}> {
	const translations = (json.translations ??
		(json.data as Record<string, unknown> | undefined)?.translations) as
		| Array<Record<string, unknown>>
		| undefined;

	if (translations?.length) {
		const hasIndex = translations.some((entry) => typeof entry.index === "number");
		if (hasIndex) {
			const ordered: Array<{text: string; sourceLang: string} | undefined> = new Array(count);
			for (const entry of translations) {
				if (typeof entry.index !== "number" || entry.index < 0 || entry.index >= count) {
					throw new Error(I18n.translation.errorUnexpected());
				}
				ordered[entry.index] = parseTranslationEntry(entry, sourceTexts?.[entry.index]);
			}
			if (ordered.some((entry) => entry === undefined)) {
				throw new Error(I18n.translation.errorUnexpected());
			}
			return ordered as Array<{text: string; sourceLang: string}>;
		}
		return translations.map((entry, index) => parseTranslationEntry(entry, sourceTexts?.[index]));
	}

	const directText = json.translatedText;
	const directSources = json.detectedSourceLanguages ?? json.detectedSourceLanguage;
	if (Array.isArray(directText)) {
		return directText.map((text, index) => ({
			text: typeof text === "string" ? text : "",
			sourceLang:
				Array.isArray(directSources) && typeof directSources[index] === "string"
					? (directSources[index] as string)
					: typeof directSources === "string"
						? directSources
						: "auto",
		}));
	}

	if (count === 1) {
		return [parseTranslateResponse(json)];
	}

	throw new Error(I18n.translation.errorUnexpected());
}

async function handleRateLimitedResponse(
	json: RateLimitedResponse,
	retry: (capToken?: string) => Promise<unknown>,
): Promise<unknown> {
	if (requiresKeycloakAuth(json)) {
		throw new SovrahiRequiresKeycloakError();
	}

	const capEndpoint = getCapEndpoint(json);
	if (capEndpoint || json.cap_required) {
		if (!capEndpoint) {
			throw new Error(json.message || I18n.translation.errorRateLimited());
		}
		const solvedCapToken = await solveCapChallenge(capEndpoint);
		return retry(solvedCapToken);
	}

	throw new Error(json.message || I18n.translation.errorRateLimited());
}

function parseChannelPath(): {guildId: string; channelId: string; messageId: string} {
	const parts = window.location.pathname.split("/");
	return {
		guildId: parts[2] || "@me",
		channelId: parts[3] || "",
		messageId: parts[4] || "0",
	};
}

async function handleTranslationResponseJson(
	json: Record<string, unknown>,
	retry: (capToken?: string) => Promise<unknown>,
): Promise<void> {
	if (json.error === "rate_limited") {
		await handleRateLimitedResponse(json as RateLimitedResponse, retry);
		return;
	}
	if (requiresKeycloakAuth(json as RateLimitedResponse)) {
		throw new SovrahiRequiresKeycloakError();
	}
}

let authPromptOpen = false;

export type SovrahiAuthContext = {
	guildId?: string;
	channelId?: string;
	messageId?: string;
};

export function promptSovrahiAuth(context?: SovrahiAuthContext): void {
	if (authPromptOpen) return;
	authPromptOpen = true;

	const path = parseChannelPath();
	const guildId = context?.guildId || path.guildId;
	const channelId = context?.channelId || path.channelId;
	const messageId = context?.messageId || path.messageId;

	showAuthRequiredDialog(
		() => {
			authPromptOpen = false;
			void SovrahiService.startAuthRedirect(guildId, channelId, messageId);
		},
		() => {
			authPromptOpen = false;
		},
	);
}

export function isExternalFeaturesEnabled(): boolean {
	const settings = getLocalSettings();
	return settings.externalFeaturesEnabled !== false;
}

export function hasTranslationConsent(): boolean {
	return localStorage.getItem(TRANSLATION_CONSENT_KEY) === "true";
}

export function setTranslationConsent(): void {
	localStorage.setItem(TRANSLATION_CONSENT_KEY, "true");
}

export class SovrahiService {
	static hasValidToken(): boolean {
		const auth = readAuth();
		if (!auth) return false;
		return auth.expiresAt > Date.now() + 30_000;
	}

	static getCachedTranslation(
		messageId: string,
		targetLang: string,
		sourceText?: string,
	): CachedTranslation | null {
		const cache = readTranslationCache();
		const key = cacheKey(messageId, targetLang);
		const entry = cache[key];
		if (!entry) return null;
		if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
			delete cache[key];
			writeTranslationCache(cache);
			return null;
		}
		if (sourceText !== undefined && entry.sourceText !== sourceText) {
			delete cache[key];
			writeTranslationCache(cache);
			return null;
		}
		return entry;
	}

	static cacheTranslation(
		messageId: string,
		targetLang: string,
		text: string,
		sourceLang: string,
		sourceText: string,
		hidden = false,
	): void {
		const cache = readTranslationCache();
		const key = cacheKey(messageId, targetLang);
		cache[key] = {
			text,
			sourceLang,
			targetLang,
			sourceText,
			cachedAt: Date.now(),
			hidden,
		};
		writeTranslationCache(cache);
	}

	static setTranslationHidden(messageId: string, targetLang: string, hidden: boolean): void {
		const cache = readTranslationCache();
		const key = cacheKey(messageId, targetLang);
		const entry = cache[key];
		if (!entry) return;
		entry.hidden = hidden;
		writeTranslationCache(cache);
	}

	static invalidateTranslation(messageId: string): void {
		const cache = readTranslationCache();
		const prefix = `${messageId}:`;
		let changed = false;
		for (const key of Object.keys(cache)) {
			if (key.startsWith(prefix)) {
				delete cache[key];
				changed = true;
			}
		}
		if (changed) writeTranslationCache(cache);
	}

	static async startAuthRedirect(
		guildId: string,
		channelId: string,
		messageId: string,
	): Promise<void> {
		sessionStorage.setItem(PENDING_TRANSLATE_KEY, messageId);
		const redirectUri = buildMessageRedirectUri(guildId, channelId, messageId);
		sessionStorage.setItem(AUTH_REDIRECT_URI_KEY, redirectUri);
		const verifier = generateCodeVerifier();
		sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
		const challenge = await generateCodeChallenge(verifier);
		const params = new URLSearchParams({
			client_id: CLIENT_ID,
			response_type: "code",
			redirect_uri: redirectUri,
			scope: "openid profile email",
			code_challenge: challenge,
			code_challenge_method: "S256",
		});
		window.location.href = `${AUTH_ENDPOINT}?${params.toString()}`;
	}

	static async exchangeCodeForToken(code: string, redirectUri: string): Promise<void> {
		const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
		if (!verifier) {
			throw new Error(I18n.translation.errorAuth());
		}

		const body = new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			redirect_uri: redirectUri,
			code_verifier: verifier,
		});

		const response = await fetch(TOKEN_ENDPOINT, {
			method: "POST",
			headers: {"Content-Type": "application/x-www-form-urlencoded"},
			body,
		});

		sessionStorage.removeItem(PKCE_VERIFIER_KEY);

		if (!response.ok) {
			clearAuth();
			throw new Error(I18n.translation.errorAuth());
		}

		const json = (await response.json()) as {
			access_token?: string;
			refresh_token?: string;
			expires_in?: number;
		};

		if (!json.access_token) {
			throw new Error(I18n.translation.errorAuth());
		}

		const expiresAt = json.expires_in
			? Date.now() + json.expires_in * 1000
			: parseJwtExpiry(json.access_token);

		writeAuth({
			accessToken: json.access_token,
			refreshToken: json.refresh_token,
			expiresAt,
		});
	}

	static async refreshTokenIfNeeded(): Promise<string> {
		const auth = readAuth();
		if (!auth) {
			throw new Error(I18n.translation.errorAuth());
		}

		if (auth.expiresAt > Date.now() + 60_000) {
			return auth.accessToken;
		}

		if (!auth.refreshToken) {
			clearAuth();
			throw new Error(I18n.translation.errorAuth());
		}

		const body = new URLSearchParams({
			grant_type: "refresh_token",
			client_id: CLIENT_ID,
			refresh_token: auth.refreshToken,
		});

		const response = await fetch(TOKEN_ENDPOINT, {
			method: "POST",
			headers: {"Content-Type": "application/x-www-form-urlencoded"},
			body,
		});

		if (!response.ok) {
			clearAuth();
			throw new Error(I18n.translation.errorAuth());
		}

		const json = (await response.json()) as {
			access_token?: string;
			refresh_token?: string;
			expires_in?: number;
		};

		if (!json.access_token) {
			clearAuth();
			throw new Error(I18n.translation.errorAuth());
		}

		const updated: StoredAuth = {
			accessToken: json.access_token,
			refreshToken: json.refresh_token || auth.refreshToken,
			expiresAt: json.expires_in
				? Date.now() + json.expires_in * 1000
				: parseJwtExpiry(json.access_token),
		};
		writeAuth(updated);
		return updated.accessToken;
	}

	static async handleAuthCallback(): Promise<string | undefined> {
		const params = new URLSearchParams(window.location.search);
		const code = params.get("code");
		let messageId =
			sessionStorage.getItem(PENDING_TRANSLATE_KEY) ||
			params.get("translateMessageId") ||
			undefined;
		if (messageId && !sessionStorage.getItem(PENDING_TRANSLATE_KEY)) {
			sessionStorage.setItem(PENDING_TRANSLATE_KEY, messageId);
		}

		if (code) {
			try {
				await this.exchangeCodeForToken(code, getRedirectUri());
			} catch (error) {
				console.error("Sovrahi auth callback failed", error);
				alert(I18n.translation.errorAuth());
				sessionStorage.removeItem(PENDING_TRANSLATE_KEY);
			}
			sessionStorage.removeItem(AUTH_REDIRECT_URI_KEY);
			cleanOAuthParamsFromUrl();
		}

		if (messageId && !code) {
			cleanOAuthParamsFromUrl();
		}

		return messageId;
	}

	static consumePendingTranslateMessageId(): string | undefined {
		const messageId = sessionStorage.getItem(PENDING_TRANSLATE_KEY) || undefined;
		if (messageId) {
			sessionStorage.removeItem(PENDING_TRANSLATE_KEY);
		}
		return messageId;
	}

	static async translateText(text: string, targetLang: string): Promise<TranslateResult> {
		return this.requestTranslation(
			`__text__:${Date.now()}`,
			{text, targetLang},
			undefined,
			undefined,
			true,
		);
	}

	static buildTranslationBatches(
		items: BatchTranslateItem[],
		{maxCount = 5, maxChars = 3000} = {},
	): BatchTranslateItem[][] {
		const batches: BatchTranslateItem[][] = [];
		let current: BatchTranslateItem[] = [];
		let charCount = 0;

		for (const item of items) {
			if (item.text.length > maxChars) {
				if (current.length) {
					batches.push(current);
					current = [];
					charCount = 0;
				}
				batches.push([item]);
				continue;
			}
			if (
				current.length >= maxCount ||
				(charCount > 0 && charCount + item.text.length > maxChars)
			) {
				batches.push(current);
				current = [];
				charCount = 0;
			}
			current.push(item);
			charCount += item.text.length;
		}
		if (current.length) batches.push(current);
		return batches;
	}

	static async translateMessagesBatch(
		items: BatchTranslateItem[],
		targetLang: string,
	): Promise<BatchTranslateResultItem[]> {
		if (!items.length) return [];

		const cached: BatchTranslateResultItem[] = [];
		const toFetch: BatchTranslateItem[] = [];
		for (const item of items) {
			const hit = this.getCachedTranslation(
				item.messageId,
				targetLang,
				item.sourceText ?? item.text,
			);
			if (hit) {
				cached.push({messageId: item.messageId, text: hit.text, sourceLang: hit.sourceLang});
			} else {
				toFetch.push(item);
			}
		}
		if (!toFetch.length) return cached;

		let token: string | undefined;
		if (this.hasValidToken()) {
			try {
				token = await this.refreshTokenIfNeeded();
			} catch {
				clearAuth();
			}
		}

		const fetched = await this.requestBatchTranslation(toFetch, targetLang, token);
		return [...cached, ...fetched];
	}

	private static async requestBatchTranslation(
		items: BatchTranslateItem[],
		targetLang: string,
		token?: string,
		capToken?: string,
		retryCount = 0,
	): Promise<BatchTranslateResultItem[]> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}
		if (capToken) {
			headers["X-Cap-Token"] = capToken;
		}

		const texts = items.map((item) => item.text);
		const response = await fetch(TRANSLATE_ENDPOINT, {
			method: "POST",
			headers,
			body: JSON.stringify({
				q: texts,
				source: "auto",
				target: targetLang,
				format: "text",
			}),
		});

		if (!response.ok) {
			const json = (await response.json().catch(() => ({}))) as RateLimitedResponse & AbuseResponse;
			if (json.error === "rate_limited") {
				return (await handleRateLimitedResponse(json, (newCapToken) =>
					this.requestBatchTranslation(items, targetLang, token, newCapToken, retryCount),
				)) as BatchTranslateResultItem[];
			}
			if (json.error === "upstream_error") {
				if (retryCount < MAX_UPSTREAM_RETRIES) {
					return this.retryWithBackoff(
						() => this.requestBatchTranslation(items, targetLang, token, capToken, retryCount + 1),
						retryCount,
					);
				}
				throw new Error(json.message || I18n.translation.errorUnexpected());
			}
			if (response.status === 401) {
				if (token) {
					clearAuth();
					return this.requestBatchTranslation(items, targetLang, undefined, capToken, retryCount);
				}
				throw new SovrahiRequiresKeycloakError();
			}
			if (requiresKeycloakAuth(json)) {
				throw new SovrahiRequiresKeycloakError();
			}
			throw new Error(json.message || I18n.translation.errorUnexpected());
		}

		const json = (await response.json()) as Record<string, unknown>;
		if ((json as Record<string, unknown>).error === "upstream_error") {
			if (retryCount < MAX_UPSTREAM_RETRIES) {
				return this.retryWithBackoff(
					() => this.requestBatchTranslation(items, targetLang, token, capToken, retryCount + 1),
					retryCount,
				);
			}
			throw new Error(I18n.translation.errorUnexpected());
		}
		await handleTranslationResponseJson(json, (newCapToken) =>
			this.requestBatchTranslation(items, targetLang, token, newCapToken, retryCount),
		);
		const parsed = parseBatchTranslateResponse(
			json,
			items.length,
			items.map((item) => item.text),
		);
		if (parsed.length !== items.length) {
			throw new Error(I18n.translation.errorUnexpected());
		}

		const results: BatchTranslateResultItem[] = [];
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			const translation = parsed[i];
			results.push({
				messageId: item.messageId,
				text: translation.text,
				sourceLang: translation.sourceLang,
			});
		}
		return results;
	}

	static async translateMessage(
		messageId: string,
		request: TranslateRequest,
	): Promise<TranslateResult> {
		const cached = this.getCachedTranslation(messageId, request.targetLang, request.sourceText);
		if (cached) {
			return {text: cached.text, sourceLang: cached.sourceLang, fromCache: true};
		}

		let token: string | undefined;
		if (this.hasValidToken()) {
			try {
				token = await this.refreshTokenIfNeeded();
			} catch {
				clearAuth();
			}
		}

		return this.requestTranslation(messageId, request, token);
	}

	// bleh
	private static async retryWithBackoff<T>(fn: () => Promise<T>, retryCount: number): Promise<T> {
		const delay = 1000 * Math.pow(2, retryCount);
		await new Promise((resolve) => setTimeout(resolve, delay));
		return fn();
	}

	private static async requestTranslation(
		messageId: string,
		request: TranslateRequest,
		token?: string,
		capToken?: string,
		skipCache = false,
		retryCount = 0,
	): Promise<TranslateResult> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}
		if (capToken) {
			headers["X-Cap-Token"] = capToken;
		}

		const response = await fetch(TRANSLATE_ENDPOINT, {
			method: "POST",
			headers,
			body: JSON.stringify({
				q: request.text,
				source: "auto",
				target: request.targetLang,
				format: "text",
			}),
		});

		if (!response.ok) {
			const json = (await response.json().catch(() => ({}))) as RateLimitedResponse & AbuseResponse;
			if (json.error === "rate_limited") {
				return (await handleRateLimitedResponse(json, (newCapToken) =>
					this.requestTranslation(messageId, request, token, newCapToken, skipCache, retryCount),
				)) as TranslateResult;
			}
			if (json.error === "upstream_error") {
				if (retryCount < MAX_UPSTREAM_RETRIES) {
					return this.retryWithBackoff(
						() =>
							this.requestTranslation(
								messageId,
								request,
								token,
								capToken,
								skipCache,
								retryCount + 1,
							),
						retryCount,
					);
				}
				throw new Error(json.message || I18n.translation.errorUnexpected());
			}
			if (response.status === 401) {
				if (token) {
					clearAuth();
					return this.requestTranslation(
						messageId,
						request,
						undefined,
						capToken,
						skipCache,
						retryCount,
					);
				}
				throw new SovrahiRequiresKeycloakError();
			}
			if (requiresKeycloakAuth(json)) {
				throw new SovrahiRequiresKeycloakError();
			}
			throw new Error(json.message || I18n.translation.errorUnexpected());
		}

		const json = (await response.json()) as Record<string, unknown>;
		if ((json as Record<string, unknown>).error === "upstream_error") {
			if (retryCount < MAX_UPSTREAM_RETRIES) {
				return this.retryWithBackoff(
					() =>
						this.requestTranslation(messageId, request, token, capToken, skipCache, retryCount + 1),
					retryCount,
				);
			}
			throw new Error(I18n.translation.errorUnexpected());
		}
		await handleTranslationResponseJson(json, (newCapToken) =>
			this.requestTranslation(messageId, request, token, newCapToken, skipCache, retryCount),
		);
		const parsed = parseTranslateResponse(json);
		if (!skipCache) {
			this.cacheTranslation(
				messageId,
				request.targetLang,
				parsed.text,
				parsed.sourceLang,
				request.sourceText ?? request.text,
			);
		}
		return {...parsed, fromCache: false};
	}
}

export function showAuthRequiredDialog(onConnect: () => void, onCancel?: () => void): void {
	const dialog = new Dialog(I18n.translation.authRequiredTitle(), {noSubmit: true});
	const body = document.createElement("p");
	body.style.whiteSpace = "pre-line";
	body.textContent = I18n.translation.authRequiredText();
	dialog.options.addHTMLArea(body);
	dialog.options.addButtonInput("", I18n.translation.authConnect(), () => {
		dialog.hide();
		onConnect();
	});
	dialog.options.addButtonInput("", I18n.translation.cancel(), () => {
		dialog.hide();
		onCancel?.();
	});
	const center = dialog.show(false);
	center.classList.add("sovrahiAuthDialog");
	const background = center.parentElement;
	if (background) {
		background.classList.remove("solidBackground");
		background.classList.add("changelogBackdrop");
	}
}
