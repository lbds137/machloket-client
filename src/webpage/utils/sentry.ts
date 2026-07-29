import * as Sentry from "@sentry/browser";

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const tunnel = import.meta.env.VITE_SENTRY_TUNNEL as string | undefined;
const environment = import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined;
const tracesSampleRate = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? "0");

let initialized = false;
let versionPromise: Promise<string> | null = null;

function loadFermoVersion(): Promise<string> {
	if (versionPromise) return versionPromise;
	versionPromise = fetch("/getupdates", {cache: "no-store"})
		.then(async (response) => {
			let version = "dev";
			if (response.ok) {
				const text = (await response.text()).trim();
				if (text && !text.toLowerCase().startsWith("<!doctype html") && !text.includes("<html")) {
					version = text;
				}
			}
			return version;
		})
		.catch(() => "dev");
	return versionPromise;
}

export async function initSentry(): Promise<void> {
	if (initialized) return;
	if (!dsn) {
		console.warn("[Sentry] No VITE_SENTRY_DSN set, skipping initialization");
		return;
	}

	const version = await loadFermoVersion();

	Sentry.init({
		dsn,
		tunnel,
		environment: environment || "production",
		tracesSampleRate,
		release: version,
		integrations: (defaultIntegrations) => {
			return defaultIntegrations.filter((i) => i.name !== "BrowserSession");
		},
	});

	if (tracesSampleRate > 0) {
		Sentry.addIntegration(Sentry.browserTracingIntegration());
	}

	initialized = true;
}

export function setSentryUser(user: {id: string; username?: string; avatar?: string}): void {
	Sentry.setUser(user);
}

export function clearSentryUser(): void {
	Sentry.setUser(null);
}

/**
 * Set a custom tag on Sentry events
 */
export function setSentryTag(key: string, value: string): void {
	Sentry.setTag(key, value);
}

/**
 * Set custom extra context on Sentry events.
 */
export function setSentryExtra(key: string, value: unknown): void {
	Sentry.setExtra(key, value);
}

/**
 * Manually capture an exception.
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
	Sentry.captureException(error, context ? {extra: context} : undefined);
}

export {Sentry};
