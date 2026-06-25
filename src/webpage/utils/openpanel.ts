import {OpenPanel} from "@openpanel/sdk";

import {getLocalSettings, OpenPanelAnalyticsMode} from "./storage/localSettings";

type OpenPanelInstance = InstanceType<typeof OpenPanel>;

type OpenPanelIdentity = {
	profileId: string;
	firstName?: string;
	avatar?: string;
	properties?: Record<string, unknown>;
};

type OpenPanelTrackProps = Record<string, unknown>;

const clientId = import.meta.env.VITE_OP_CLIENT_ID as string | undefined;
const apiUrl = import.meta.env.VITE_OP_API_URL?.replace(/\/+$/, "");
const replaySampleRate = Number(import.meta.env.VITE_OP_REPLAY_SAMPLE_RATE ?? "0");

type OpenpanelApiClient = {
	maxRetries: number;
	initialRetryDelay: number;
	resolveHeaders(): Promise<Record<string, string>>;
};

function parseOpenpanelResponse(text: string): Record<string, unknown> | null {
	try {
		return JSON.parse(text) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function hardenOpenpanelClient(inst: OpenPanelInstance): void {
	const api = inst.api as unknown as OpenpanelApiClient & {
		post(
			url: string,
			body: unknown,
			opts: RequestInit,
			retry: number,
		): Promise<Record<string, unknown> | null>;
	};

	api.post = async (url, body, opts, retry) => {
		try {
			const response = await fetch(url, {
				method: "POST",
				headers: await api.resolveHeaders(),
				body: body ? JSON.stringify(body ?? {}) : undefined,
				keepalive: true,
				...opts,
			});
			if (response.status === 401) return null;
			if (response.status !== 200 && response.status !== 202) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			const text = await response.text();
			if (!text) return null;
			return parseOpenpanelResponse(text);
		} catch {
			if (retry < api.maxRetries) {
				const delay = api.initialRetryDelay * 2 ** retry;
				await new Promise((resolve) => setTimeout(resolve, delay));
				return api.post(url, body, opts, retry + 1);
			}
			return null;
		}
	};
}

function safeOpenpanelCall(promise: Promise<unknown> | undefined | void): void {
	void Promise.resolve(promise).catch(() => {});
}

let op: OpenPanelInstance | null = null;
let replaySampled = false;
let errorTrackingInstalled = false;
let sessionOpenTracked = false;
let unloadTrackingInstalled = false;
let fermoVersion = "dev";
let fermoVersionPromise: Promise<string> | null = null;

function canInitOpenpanel(): boolean {
	return Boolean(clientId && apiUrl);
}

function getTrackingMode() {
	const settings = getLocalSettings();
	if (settings.openpanelEnabled === false) return undefined;
	if (settings.openpanelAnalyticsMode === OpenPanelAnalyticsMode.Disabled) return undefined;
	return settings.openpanelAnalyticsMode;
}

function canTrackFeatureEvents() {
	return getTrackingMode() === OpenPanelAnalyticsMode.Default;
}

function canTrackErrorEvents() {
	const mode = getTrackingMode();
	return mode === OpenPanelAnalyticsMode.Default || mode === OpenPanelAnalyticsMode.ErrorSending;
}

function canTrackSessionEvents() {
	return getTrackingMode() !== undefined;
}

function loadFermoVersion(): Promise<string> {
	if (fermoVersionPromise) return fermoVersionPromise;
	fermoVersionPromise = fetch("/getupdates", {cache: "no-store"})
		.then(async (response) => {
			let version = "dev";
			if (response.ok) {
				const text = (await response.text()).trim();
				if (text && !text.toLowerCase().startsWith("<!doctype html") && !text.includes("<html")) {
					version = text;
				}
			}
			fermoVersion = version;
			if (op?.setGlobalProperties) {
				op.setGlobalProperties({
					app_origin: window.location.origin,
					replay_sampled: replaySampled,
					analytics_mode: getTrackingMode(),
					fermo_version: fermoVersion,
				});
			}
			return version;
		})
		.catch(() => fermoVersion);
	return fermoVersionPromise;
}

void loadFermoVersion();

export function isOpenpanelConfigured(): boolean {
	return canInitOpenpanel();
}

export function getOpenpanelReplaySampleRate(): number {
	return replaySampleRate;
}

export function initOpenpanel(force = false): OpenPanelInstance | null {
	const settings = getLocalSettings();
	if (
		!canInitOpenpanel() ||
		settings.openpanelEnabled === false ||
		settings.openpanelAnalyticsMode === undefined
	) {
		return null;
	}
	if (op && !force) {
		return op;
	}
	replaySampled = Math.random() < replaySampleRate;
	const options = {
		clientId,
		apiUrl,
		replaySampleRate,
		replaySampled,
	} as Record<string, unknown>;
	op = new OpenPanel(options as unknown as ConstructorParameters<typeof OpenPanel>[0]);
	hardenOpenpanelClient(op);
	if (op.setGlobalProperties) {
		op.setGlobalProperties({
			app_origin: window.location.origin,
			replay_sampled: replaySampled,
			analytics_mode: settings.openpanelAnalyticsMode,
			fermo_version: fermoVersion,
		});
	}
	if (!sessionOpenTracked && canTrackSessionEvents()) {
		sessionOpenTracked = true;
		safeOpenpanelCall(
			op.track("session_open", {
				mode: settings.openpanelAnalyticsMode,
			}),
		);
	}
	if (!unloadTrackingInstalled) {
		unloadTrackingInstalled = true;
		window.addEventListener("beforeunload", () => {
			if (!op || !canTrackSessionEvents() || !sessionOpenTracked) return;
			safeOpenpanelCall(
				op.track("session_close", {
					mode: getTrackingMode(),
				}),
			);
		});
	}
	return op;
}

export function sendOpenpanelAnalytics(event: string, props: OpenPanelTrackProps = {}): void {
	if (!canTrackFeatureEvents()) return;
	const inst = initOpenpanel();
	if (!inst) return;
	safeOpenpanelCall(inst.track(event, props));
}

export function sendOpenpanelError(event: string, props: OpenPanelTrackProps = {}): void {
	if (!canTrackErrorEvents()) return;
	const inst = initOpenpanel();
	if (!inst) return;
	safeOpenpanelCall(inst.track(event, props));
}

export function sendOpenpanelSession(event: string, props: OpenPanelTrackProps = {}): void {
	if (!canTrackSessionEvents()) return;
	const inst = initOpenpanel();
	if (!inst) return;
	safeOpenpanelCall(inst.track(event, props));
}

export function sendOpenpanelAnalyticsModeChange(
	from: OpenPanelAnalyticsMode | undefined,
	to: OpenPanelAnalyticsMode,
): void {
	sendOpenpanelSession("analytics_mode_changed", {
		from,
		to,
	});
}

export function identifyOpenpanel(identity: OpenPanelIdentity): void {
	if (!canTrackFeatureEvents()) return;
	const inst = initOpenpanel();
	if (!inst) return;
	safeOpenpanelCall(inst.identify(identity));
}

export function clearOpenpanel(): void {
	if (op && canTrackSessionEvents() && sessionOpenTracked) {
		safeOpenpanelCall(
			op.track("session_close", {
				mode: getTrackingMode(),
			}),
		);
	}
	sessionOpenTracked = false;
	op?.clear?.();
	op = null;
}

export function installOpenpanelErrorTracking(): void {
	if (errorTrackingInstalled) return;
	errorTrackingInstalled = true;
	window.addEventListener("error", (event) => {
		const err = event.error;
		if (!(err instanceof Error)) return;
		sendOpenpanelError("error_spotted", {
			name: err.name,
			message: err.message,
			stack: err.stack,
			filename: event.filename,
			lineno: event.lineno,
			colno: event.colno,
		});
	});
	window.addEventListener("unhandledrejection", (event) => {
		const reason = event.reason;
		if (!(reason instanceof Error)) return;
		sendOpenpanelError("error_spotted", {
			name: reason.name,
			message: reason.message,
			stack: reason.stack,
		});
	});
}
