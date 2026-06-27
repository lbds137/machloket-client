import {I18n} from "../i18n.js";
import {Dialog} from "../settings.js";
import {getLocalSettings} from "../utils/storage/localSettings.js";

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
	message?: string;
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

type CapChallengeResponse = {
	site_key?: string;
	challenge?: string;
	script_url?: string;
	widget_url?: string;
	token?: string;
};

type CapGlobal = {
	render?: (
		container: HTMLElement,
		options: {
			siteKey?: string;
			challenge?: string;
			endpoint?: string;
			onSuccess?: (token: string) => void;
			onError?: (error: Error) => void;
		},
	) => void;
	solve?: (endpoint: string) => Promise<string>;
};

declare global {
	interface Window {
		SovrahiCap?: CapGlobal;
		Cap?: CapGlobal;
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

function parseTranslateResponse(json: Record<string, unknown>): {text: string; sourceLang: string} {
	const directText = json.translatedText ?? json.translation ?? json.text;
	const directSource = json.detectedSourceLanguage ?? json.source_language ?? json.source;
	if (typeof directText === "string") {
		return {
			text: directText,
			sourceLang: typeof directSource === "string" ? directSource : "auto",
		};
	}

	const data = json.data as Record<string, unknown> | undefined;
	const translations = data?.translations as Array<Record<string, unknown>> | undefined;
	if (translations?.[0]) {
		const first = translations[0];
		const text = first.translatedText ?? first.text;
		const sourceLang = first.detectedSourceLanguage ?? first.source;
		if (typeof text === "string") {
			return {
				text,
				sourceLang: typeof sourceLang === "string" ? sourceLang : "auto",
			};
		}
	}

	throw new Error(I18n.translation.errorUnexpected());
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

	static async translateMessage(
		messageId: string,
		request: TranslateRequest,
	): Promise<TranslateResult> {
		const cached = this.getCachedTranslation(messageId, request.targetLang);
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

	private static async requestTranslation(
		messageId: string,
		request: TranslateRequest,
		token?: string,
		capToken?: string,
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

		if (response.status === 429) {
			const json = (await response.json().catch(() => ({}))) as RateLimitedResponse;
			if (json.error === "rate_limited" && json.cap_api_endpoint) {
				const solvedCapToken = await this.solveCapChallenge(json.cap_api_endpoint);
				return this.requestTranslation(messageId, request, token, solvedCapToken);
			}
			throw new Error(I18n.translation.errorRateLimited());
		}

		if (response.status === 403) {
			const json = (await response.json().catch(() => ({}))) as AbuseResponse;
			if (json.requires_keycloak) {
				throw new SovrahiRequiresKeycloakError();
			}
			throw new Error(json.message || I18n.translation.errorUnexpected());
		}

		if (!response.ok) {
			const json = (await response.json().catch(() => ({}))) as {message?: string};
			if (response.status === 401) {
				if (token) {
					clearAuth();
					return this.requestTranslation(messageId, request, undefined, capToken);
				}
				throw new SovrahiRequiresKeycloakError();
			}
			throw new Error(json.message || I18n.translation.errorUnexpected());
		}

		const json = (await response.json()) as Record<string, unknown>;
		const parsed = parseTranslateResponse(json);
		this.cacheTranslation(
			messageId,
			request.targetLang,
			parsed.text,
			parsed.sourceLang,
			request.text,
		);
		return {...parsed, fromCache: false};
	}

	private static loadScript(url: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const existing = document.querySelector(`script[data-sovrahi-cap="${url}"]`);
			if (existing) {
				resolve();
				return;
			}
			const script = document.createElement("script");
			script.src = url;
			script.async = true;
			script.dataset.sovrahiCap = url;
			script.onload = () => resolve();
			script.onerror = () => reject(new Error(I18n.translation.capError()));
			document.head.append(script);
		});
	}

	private static getCapApi(): CapGlobal | undefined {
		return window.SovrahiCap || window.Cap;
	}

	static async solveCapChallenge(capApiEndpoint: string): Promise<string> {
		const dialog = new Dialog(I18n.translation.capVerificationNeeded(), {noSubmit: true});
		const container = document.createElement("div");
		container.classList.add("sovrahiCapContainer");

		const status = document.createElement("p");
		status.textContent = I18n.translation.capVerificationNeeded();
		container.append(status);

		dialog.options.addHTMLArea(container);
		const center = dialog.show(false);
		center.classList.add("sovrahiCapDialog");
		const background = center.parentElement as HTMLDivElement | null;

		try {
			let challenge: CapChallengeResponse | undefined;
			try {
				const challengeResponse = await fetch(capApiEndpoint, {
					method: "GET",
					headers: {Accept: "application/json"},
				});
				if (challengeResponse.ok) {
					challenge = (await challengeResponse.json()) as CapChallengeResponse;
					if (challenge.token) {
						dialog.hide();
						return challenge.token;
					}
				}
			} catch {
				// fall back
			}

			const capApi = this.getCapApi();
			if (capApi?.solve) {
				const token = await capApi.solve(capApiEndpoint);
				dialog.hide();
				return token;
			}

			const widgetUrl = challenge?.widget_url;
			const scriptUrl =
				challenge?.script_url ||
				(capApiEndpoint.endsWith(".js")
					? capApiEndpoint
					: `${capApiEndpoint.replace(/\/$/, "")}/widget.js`);

			if (widgetUrl) {
				const iframe = document.createElement("iframe");
				iframe.src = widgetUrl;
				iframe.classList.add("sovrahiCapFrame");
				container.append(iframe);
			} else {
				await this.loadScript(scriptUrl).catch(() => undefined);
			}

			const token = await new Promise<string>((resolve, reject) => {
				const timeout = window.setTimeout(() => {
					cleanup();
					reject(new Error(I18n.translation.capTimeout()));
				}, 120_000);

				const onMessage = (event: MessageEvent) => {
					const data = event.data as
						| {type?: string; token?: string; cap_token?: string; capToken?: string}
						| string;
					const payload = typeof data === "string" ? {token: data} : data;
					const capToken = payload.capToken || payload.cap_token || payload.token;
					if (!capToken) return;
					if (
						payload.type &&
						payload.type !== "sovrahi-cap-token" &&
						payload.type !== "cap-token"
					) {
						return;
					}
					cleanup();
					resolve(capToken);
				};

				const cleanup = () => {
					window.clearTimeout(timeout);
					window.removeEventListener("message", onMessage);
				};

				window.addEventListener("message", onMessage);

				const cap = this.getCapApi();
				if (cap?.render) {
					cap.render(container, {
						siteKey: challenge?.site_key,
						challenge: challenge?.challenge,
						endpoint: capApiEndpoint,
						onSuccess: (capToken) => {
							cleanup();
							resolve(capToken);
						},
						onError: (error) => {
							cleanup();
							reject(error);
						},
					});
				}
			});

			dialog.hide();
			return token;
		} catch (error) {
			dialog.hide();
			if (background) {
				background.onclick = null;
			}
			if (error instanceof Error) {
				throw error;
			}
			throw new Error(I18n.translation.capError());
		}
	}
}

export function showAuthRequiredDialog(onConnect: () => void): void {
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
	});
	const center = dialog.show(false);
	center.classList.add("sovrahiAuthDialog");
}
