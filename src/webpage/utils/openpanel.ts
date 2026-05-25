import {OpenPanel} from "@openpanel/sdk";

import {getLocalSettings} from "./storage/localSettings";

type OpenPanelInstance = InstanceType<typeof OpenPanel>;

type OpenPanelIdentity = {
	profileId: string;
	firstName?: string;
	properties?: Record<string, unknown>;
};

type OpenPanelTrackProps = Record<string, unknown>;

const clientId = import.meta.env.VITE_OP_CLIENT_ID as string | undefined;
const apiUrl = import.meta.env.VITE_OP_API_URL as string | undefined;
const replaySampleRate = Number(import.meta.env.VITE_OP_REPLAY_SAMPLE_RATE ?? "0.2");

let op: OpenPanelInstance | null = null;
let replaySampled = false;
let errorTrackingInstalled = false;

function canInitOpenpanel(): boolean {
	return Boolean(clientId && apiUrl);
}

export function isOpenpanelConfigured(): boolean {
	return canInitOpenpanel();
}

export function getOpenpanelReplaySampleRate(): number {
	return replaySampleRate;
}

export function initOpenpanel(force = false): OpenPanelInstance | null {
	const settings = getLocalSettings();
	if (!canInitOpenpanel() || settings.openpanelEnabled === false) {
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
	if (op.setGlobalProperties) {
		op.setGlobalProperties({
			app_origin: window.location.origin,
			replay_sampled: replaySampled,
		});
	}
	return op;
}

export function trackOpenpanel(event: string, props: OpenPanelTrackProps = {}): void {
	const inst = initOpenpanel();
	if (!inst) return;
	inst.track(event, props);
}

export function identifyOpenpanel(identity: OpenPanelIdentity): void {
	const inst = initOpenpanel();
	if (!inst) return;
	inst.identify(identity);
}

export function clearOpenpanel(): void {
	op?.clear?.();
	op = null;
}

export function installOpenpanelErrorTracking(): void {
	if (errorTrackingInstalled) return;
	errorTrackingInstalled = true;
	window.addEventListener("error", (event) => {
		const err = event.error;
		if (!(err instanceof Error)) return;
		trackOpenpanel("error_spotted", {
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
		trackOpenpanel("error_spotted", {
			name: reason.name,
			message: reason.message,
			stack: reason.stack,
		});
	});
}
