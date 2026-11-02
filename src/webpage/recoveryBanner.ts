import {I18n} from "./i18n.js";

export interface MfaRecoveryUpdate {
	status: string;
	completes_at?: string | null;
}

const RETRY_MS = 60_000;
const TICK_MS = 30_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export class RecoveryBanner {
	private readonly api: () => string;
	private readonly headers: () => HeadersInit;
	private generation = 0;
	private retryTimer: ReturnType<typeof setTimeout> | undefined;
	private tickTimer: ReturnType<typeof setInterval> | undefined;
	private resizeObserver: ResizeObserver | undefined;
	private completesAt: Date | null = null;
	private shown = false;
	private cancelInFlight = false;
	/** Counts stop()s: a cancel answering across one no longer owns the bar (it may be another account's now). */
	private stops = 0;

	/** `api` is read per request: a reconnect can move the session to new instance URLs. */
	constructor(api: () => string, headers: () => HeadersInit) {
		this.api = api;
		this.headers = headers;
	}

	private get url(): string {
		return this.api() + "/users/@me/mfa/recovery";
	}

	/** Reads the current state. Called at READY and RESUMED. */
	async refresh(): Promise<void> {
		this.clearRetry();
		const gen = ++this.generation;
		let res: Response;
		try {
			res = await fetch(this.url, {headers: this.headers()});
		} catch (e) {
			if (gen !== this.generation) return;
			console.warn("Couldn't read MFA recovery status:", e);
			this.scheduleRetry();
			return;
		}
		if (gen !== this.generation) return;
		if (res.status === 200) {
			const body = (await res.json().catch(() => null)) as MfaRecoveryUpdate | null;
			if (gen !== this.generation) return;
			if (body && typeof body === "object" && body.status === "pending") {
				this.show(body.completes_at);
			} else {
				// Only a 404 says nothing is pending; this could be a captive portal's page.
				console.warn("Unexpected MFA recovery answer, keeping the current state");
			}
			return;
		}
		if (res.status === 404) {
			this.hide();
			return;
		}
		console.warn(`Couldn't read MFA recovery status: HTTP ${res.status}`);
		if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
			this.scheduleRetry();
		}
	}

	/** Applies one MFA_RECOVERY_UPDATE. */
	apply(update: MfaRecoveryUpdate): void {
		if (!update || typeof update !== "object") return;
		if (update.status === "pending") {
			this.generation++;
			this.clearRetry();
			this.show(update.completes_at);
		} else if (update.status === "cancelled" || update.status === "completed") {
			this.generation++;
			this.clearRetry();
			this.hide();
		} else {
			console.warn(`Unknown MFA recovery status: ${String(update.status)}`);
		}
	}

	/** Hides the bar and abandons any request in flight and any retry. A later refresh() works again. */
	stop(): void {
		this.stops++;
		this.generation++;
		this.clearRetry();
		this.hide();
	}

	private clearRetry(): void {
		if (this.retryTimer !== undefined) {
			clearTimeout(this.retryTimer);
			this.retryTimer = undefined;
		}
	}

	private scheduleRetry(): void {
		this.clearRetry();
		this.retryTimer = setTimeout(() => {
			this.retryTimer = undefined;
			void this.refresh();
		}, RETRY_MS);
	}

	private clearTick(): void {
		if (this.tickTimer !== undefined) {
			clearInterval(this.tickTimer);
			this.tickTimer = undefined;
		}
	}

	private show(completesAtRaw?: string | null): void {
		let parsed: Date | null = null;
		if (typeof completesAtRaw === "string" && completesAtRaw.length > 0) {
			const d = new Date(completesAtRaw);
			if (!Number.isNaN(d.getTime())) {
				parsed = d;
			}
		}
		this.completesAt = parsed;
		this.clearTick();

		const banner = document.getElementById("recoveryBanner");
		if (!banner) {
			this.shown = false;
			return;
		}

		const freshShow = !this.shown || banner.hidden;
		if (freshShow) {
			this.cancelInFlight = false;
			const errorEl = document.getElementById("recoveryBannerError");
			if (errorEl) {
				errorEl.hidden = true;
				errorEl.textContent = "";
			}
		}
		this.shown = true;

		const cancelBtn = document.getElementById("recoveryBannerCancel") as HTMLButtonElement | null;
		if (cancelBtn) {
			cancelBtn.onclick = () => {
				void this.cancel();
			};
		}

		this.render();
		banner.hidden = false;
		document.documentElement.style.setProperty("--notice-height", `${banner.offsetHeight}px`);

		this.resizeObserver?.disconnect();
		if (typeof ResizeObserver !== "undefined") {
			this.resizeObserver = new ResizeObserver(() => {
				const el = document.getElementById("recoveryBanner");
				if (el && !el.hidden) {
					document.documentElement.style.setProperty("--notice-height", `${el.offsetHeight}px`);
				}
			});
			this.resizeObserver.observe(banner);
		}

		if (this.completesAt) {
			this.tickTimer = setInterval(() => {
				this.render();
			}, TICK_MS);
		}
	}

	private render(): void {
		const textEl = document.getElementById("recoveryBannerText");
		const whenEl = document.getElementById("recoveryBannerWhen");
		const cancelBtn = document.getElementById("recoveryBannerCancel") as HTMLButtonElement | null;

		const nextText = this.completesAt
			? I18n.mfaRecovery.pendingAt(
					new Intl.DateTimeFormat(I18n.locale, {
						dateStyle: "medium",
						timeStyle: "short",
					}).format(this.completesAt),
				)
			: I18n.mfaRecovery.pending();
		if (textEl && textEl.textContent !== nextText) {
			textEl.textContent = nextText;
		}

		if (whenEl) {
			if (this.completesAt) {
				whenEl.hidden = false;
				whenEl.textContent = this.formatCountdown(this.completesAt);
			} else {
				whenEl.hidden = true;
				whenEl.textContent = "";
			}
		}

		if (cancelBtn) {
			const label = I18n.mfaRecovery.cancel();
			if (cancelBtn.textContent !== label) {
				cancelBtn.textContent = label;
			}
			cancelBtn.disabled = this.cancelInFlight;
		}
	}

	private formatCountdown(target: Date): string {
		const remainingMs = target.getTime() - Date.now();
		if (remainingMs <= 0) {
			return I18n.mfaRecovery.anyMoment();
		}
		const rtf = new Intl.RelativeTimeFormat(I18n.locale, {numeric: "always"});
		if (remainingMs >= HOUR_MS) {
			return rtf.format(Math.ceil(remainingMs / HOUR_MS), "hour");
		}
		return rtf.format(Math.ceil(remainingMs / MINUTE_MS), "minute");
	}

	private hide(): void {
		this.shown = false;
		this.completesAt = null;
		this.cancelInFlight = false;
		this.clearTick();
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		document.documentElement.style.removeProperty("--notice-height");

		const banner = document.getElementById("recoveryBanner");
		if (banner) {
			banner.hidden = true;
		}
		const whenEl = document.getElementById("recoveryBannerWhen");
		if (whenEl) {
			whenEl.hidden = true;
			whenEl.textContent = "";
		}
		const errorEl = document.getElementById("recoveryBannerError");
		if (errorEl) {
			errorEl.hidden = true;
			errorEl.textContent = "";
		}
		const cancelBtn = document.getElementById("recoveryBannerCancel") as HTMLButtonElement | null;
		if (cancelBtn) {
			cancelBtn.disabled = false;
		}
	}

	private async cancel(): Promise<void> {
		if (this.cancelInFlight) return;
		this.cancelInFlight = true;
		const cancelBtn = document.getElementById("recoveryBannerCancel") as HTMLButtonElement | null;
		const errorEl = document.getElementById("recoveryBannerError");
		if (cancelBtn) {
			cancelBtn.disabled = true;
		}
		if (errorEl) {
			errorEl.hidden = true;
			errorEl.textContent = "";
		}

		const stops = this.stops;
		let res: Response | undefined;
		try {
			res = await fetch(this.url, {method: "DELETE", headers: this.headers()});
		} catch {
			res = undefined;
		}
		if (stops !== this.stops) return;

		if (res && (res.status === 204 || res.status === 404)) {
			this.cancelInFlight = false;
			this.generation++;
			this.clearRetry();
			this.hide();
			return;
		}

		this.cancelInFlight = false;
		// An event already took the bar down: nothing left to say. A re-show keeps it, and its button.
		if (!this.shown) return;

		const currentBtn = document.getElementById("recoveryBannerCancel") as HTMLButtonElement | null;
		const currentErr = document.getElementById("recoveryBannerError");
		if (currentBtn) {
			currentBtn.disabled = false;
		}
		if (currentErr) {
			currentErr.textContent = I18n.mfaRecovery.cancelFailed();
			currentErr.hidden = false;
		}
	}
}
