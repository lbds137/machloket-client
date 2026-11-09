import {trySetItem} from "./trySetItem.js";

export class DeveloperSettings {
	gatewayLogging: boolean = false;
	gatewayCompression: boolean = true;
	showTraces: boolean = false;
	interceptApiTraces: boolean = false;
	cacheSourceMaps: boolean = false;
	logBannedFields: boolean = false;
	reportSystem = false;

	constructor(data: Partial<DeveloperSettings> = {}) {
		Object.assign(this, data);
	}
}

export function getDeveloperSettings(): DeveloperSettings {
	return new DeveloperSettings(JSON.parse(localStorage.getItem("developerSettings") || "{}"));
}

export function setDeveloperSettings(settings: DeveloperSettings): void {
	localStorage.setItem("developerSettings", JSON.stringify(settings));
}

//region Migration from untyped storage
async function migrateOldDeveloperSettings(): Promise<void> {
	const devSettings = getDeveloperSettings();
	const migratedKeys: string[] = [];

	const oldGatewayLogging = localStorage.getItem("logGateway");
	if (oldGatewayLogging !== null) {
		devSettings.gatewayLogging = oldGatewayLogging === "true";
		migratedKeys.push("logGateway");
	}

	const oldGatewayCompression = localStorage.getItem("gateWayComp");
	if (oldGatewayCompression !== null) {
		devSettings.gatewayCompression = oldGatewayCompression === "true";
		migratedKeys.push("gateWayComp");
	}

	const oldShowTraces = localStorage.getItem("traces");
	if (oldShowTraces !== null) {
		devSettings.showTraces = oldShowTraces === "true";
		migratedKeys.push("traces");
	}

	const oldInterceptApiTraces = localStorage.getItem("capTrace");
	if (oldInterceptApiTraces !== null) {
		devSettings.interceptApiTraces = oldInterceptApiTraces === "true";
		migratedKeys.push("capTrace");
	}

	const oldCacheSourceMaps = localStorage.getItem("isDev");
	if (oldCacheSourceMaps !== null) {
		devSettings.cacheSourceMaps = oldCacheSourceMaps === "true";
		migratedKeys.push("isDev");
	}

	const oldLogBannedFields = localStorage.getItem("logbad");
	if (oldLogBannedFields !== null) {
		devSettings.logBannedFields = oldLogBannedFields === "true";
		migratedKeys.push("logbad");
	}

	// Awaited at module load: a refused write must not stop the app booting, and a legacy
	// key goes only once its value is saved.
	if (migratedKeys.length === 0) return;
	if (trySetItem("developerSettings", JSON.stringify(devSettings))) {
		for (const key of migratedKeys) localStorage.removeItem(key);
	}
}
await migrateOldDeveloperSettings();
//endregion
