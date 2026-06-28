import Cap from "cap-widget";
import "cap-widget";
import type {CapErrorEvent, CapProgressEvent} from "cap-widget";

import {I18n} from "../i18n.js";

const SOLVE_TIMEOUT_MS = 120_000;

let activeVerifications = 0;

function getStatusElements(): {
	statusDiv: HTMLElement | null;
	statusLabel: HTMLElement | null;
	autoTranslateBtn: HTMLElement | null;
} {
	return {
		statusDiv: document.getElementById("translationStatusDiv"),
		statusLabel: document.getElementById("translationStatusLabel"),
		autoTranslateBtn: document.getElementById("autoTranslateBtn"),
	};
}

function formatCapStatus(progress: number): string {
	if (progress > 0) {
		return `${I18n.translation.capVerifying()} (${progress}%)`;
	}
	return I18n.translation.capVerifying();
}

function showCapVerificationStatus(progress = 0): void {
	activeVerifications++;
	const {statusDiv, statusLabel, autoTranslateBtn} = getStatusElements();
	if (statusDiv) {
		statusDiv.hidden = false;
		statusDiv.classList.add("verifying");
	}
	if (statusLabel) {
		statusLabel.textContent = formatCapStatus(progress);
	}
	autoTranslateBtn?.classList.add("verifying");
}

function updateCapVerificationProgress(progress: number): void {
	const {statusLabel} = getStatusElements();
	if (statusLabel) {
		statusLabel.textContent = formatCapStatus(progress);
	}
}

function hideCapVerificationStatus(): void {
	activeVerifications = Math.max(0, activeVerifications - 1);
	if (activeVerifications > 0) return;

	const {statusDiv, statusLabel, autoTranslateBtn} = getStatusElements();
	if (statusDiv) {
		statusDiv.hidden = true;
		statusDiv.classList.remove("verifying");
	}
	if (statusLabel) {
		statusLabel.textContent = "";
	}
	autoTranslateBtn?.classList.remove("verifying");
}

function normalizeCapApiEndpoint(endpoint: string): string {
	const trimmed = endpoint.trim();
	if (!trimmed) {
		throw new Error(I18n.translation.capError());
	}
	return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

export async function solveCapChallenge(capApiEndpoint: string): Promise<string> {
	const apiEndpoint = normalizeCapApiEndpoint(capApiEndpoint);
	const cap = new Cap({apiEndpoint});
	showCapVerificationStatus(0);

	try {
		const token = await new Promise<string>((resolve, reject) => {
			let finished = false;

			const timeout = window.setTimeout(() => {
				if (finished) return;
				finished = true;
				reject(new Error(I18n.translation.capTimeout()));
			}, SOLVE_TIMEOUT_MS);

			const finish = (callback: () => void) => {
				if (finished) return;
				finished = true;
				window.clearTimeout(timeout);
				callback();
			};

			const onProgress = (event: CapProgressEvent) => {
				if (finished) return;
				updateCapVerificationProgress(Math.round(event.detail.progress));
			};

			const onError = (event: CapErrorEvent) => {
				finish(() => {
					reject(new Error(event.detail.message || I18n.translation.capError()));
				});
			};

			cap.addEventListener("progress", onProgress);
			cap.addEventListener("error", onError);

			cap
				.solve()
				.then((result) => {
					finish(() => {
						if (!result.success || !result.token) {
							reject(new Error(I18n.translation.capError()));
							return;
						}
						resolve(result.token);
					});
				})
				.catch((error: unknown) => {
					finish(() => {
						reject(error instanceof Error ? error : new Error(I18n.translation.capError()));
					});
				});
		});

		return token;
	} catch (error) {
		cap.reset();
		if (error instanceof Error) {
			throw error;
		}
		throw new Error(I18n.translation.capError());
	} finally {
		hideCapVerificationStatus();
	}
}
