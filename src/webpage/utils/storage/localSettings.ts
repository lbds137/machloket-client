export const enum ServiceWorkerMode {
	// Skips registering the service worker completely
	Unregistered = "unregistered",
	// Registers the service worker but does not activate it
	Disabled = "disabled",
	// Ensures client files are cached and used when offline
	OfflineOnly = "offlineOnly",
	// Cache everything and use cached files when possible
	Enabled = "enabled",
}

export const ServiceWorkerModeValues = [
	ServiceWorkerMode.Unregistered,
	ServiceWorkerMode.Disabled,
	ServiceWorkerMode.OfflineOnly,
	ServiceWorkerMode.Enabled,
];

export const enum OpenPanelAnalyticsMode {
	Default = "default",
	ErrorSending = "errorSending",
	JustPing = "justPing",
	Disabled = "disabled",
}

export const OpenPanelAnalyticsModeValues = [
	OpenPanelAnalyticsMode.Default,
	OpenPanelAnalyticsMode.ErrorSending,
	OpenPanelAnalyticsMode.JustPing,
	OpenPanelAnalyticsMode.Disabled,
];

export class LocalSettings {
	serviceWorkerMode: ServiceWorkerMode = ServiceWorkerMode.Unregistered;
	openpanelEnabled: boolean = true;
	openpanelAnalyticsMode?: OpenPanelAnalyticsMode;
	constructor(init?: Partial<LocalSettings>) {
		Object.assign(this, init);
	}
}

export function getLocalSettings(): LocalSettings {
	return new LocalSettings(JSON.parse(localStorage.getItem("localSettings") || "{}"));
}

export function setLocalSettings(settings: LocalSettings): void {
	localStorage.setItem("localSettings", JSON.stringify(settings));
}

//region Migration from untyped storage
function migrateOldSettings() {
	const settings = getLocalSettings();
	let mod = false;

	const oldSWMode = localStorage.getItem("SWMode");
	if (oldSWMode !== null) {
		settings.serviceWorkerMode = oldSWMode as ServiceWorkerMode;
		localStorage.removeItem("SWMode");
		mod = true;
	}

	const legacyOpenpanelEnabled = localStorage.getItem("openpanelEnabled");
	if (legacyOpenpanelEnabled !== null) {
		settings.openpanelEnabled = legacyOpenpanelEnabled === "true";
		localStorage.removeItem("openpanelEnabled");
		mod = true;
	}

	if (mod) {
		localStorage.setItem("localSettings", JSON.stringify(settings));
	}
}

migrateOldSettings();
//endregion
