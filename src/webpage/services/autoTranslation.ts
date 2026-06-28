import type {Channel} from "../channel.js";
import {Message} from "../message.js";
import {
	ensureTranslationLangConfigured,
	getTranslationLang,
	handleTranslationError,
	TranslationService,
} from "./translation.js";
import {isExternalFeaturesEnabled, SovrahiRequiresKeycloakError} from "./sovrahi.js";

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 500;
const SCROLL_SETTLE_MS = 700;

function sortIdsNewestFirst(ids: string[]): string[] {
	return [...ids].sort((a, b) => (BigInt(a) > BigInt(b) ? -1 : BigInt(a) < BigInt(b) ? 1 : 0));
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForScrollSettle(channel: Channel): Promise<boolean> {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		if (!AutoTranslationService.isEnabled()) return false;
		if (channel.localuser.channelfocus !== channel) return false;
		if (!channel.infinite.scrolling) return true;
		await wait(150);
	}
	return !channel.infinite.scrolling;
}

export class AutoTranslationService {
	private static enabled = false;
	private static blocked = false;
	private static button?: HTMLElement;
	private static getChannel?: () => Channel | undefined;
	private static cachedTargetLang?: string;
	private static scheduleTimer?: ReturnType<typeof setTimeout>;
	private static processing = false;
	private static activeChannelId?: string;
	private static autoTranslatedIds = new Set<string>();

	static getTargetLang(): string | undefined {
		return this.cachedTargetLang;
	}

	static async refreshTargetLang(): Promise<void> {
		this.cachedTargetLang = await getTranslationLang();
	}

	static isEnabled(): boolean {
		return this.enabled;
	}

	static isBlocked(): boolean {
		return this.blocked;
	}

	static bindButton(button: HTMLElement, getChannel: () => Channel | undefined): void {
		this.button = button;
		this.getChannel = getChannel;
		this.updateButton();
	}

	static updateButton(): void {
		if (!this.button) return;
		this.button.classList.toggle("active", this.enabled);
		this.button.classList.toggle("blocked", this.blocked);
		this.button.setAttribute("aria-pressed", String(this.enabled));
	}

	static disable(): void {
		if (!this.enabled && !this.processing) return;
		this.enabled = false;
		this.processing = false;
		this.activeChannelId = undefined;
		if (this.scheduleTimer) {
			clearTimeout(this.scheduleTimer);
			this.scheduleTimer = undefined;
		}
		this.hideAutoTranslatedMessages();
		this.autoTranslatedIds.clear();
		this.updateButton();
	}

	private static hideAutoTranslatedMessages(): void {
		const channel = this.getChannel?.();
		const targetLang = this.cachedTargetLang;
		if (!channel || !targetLang) return;

		for (const id of this.autoTranslatedIds) {
			const message = channel.messages.get(id);
			if (!message?.translation || message.translation.hidden) continue;
			if (message.translation.targetLang !== targetLang) continue;
			message.hideTranslation();
		}
	}

	static onBlocked(): void {
		this.blocked = true;
		this.disable();
		this.updateButton();
	}

	static async toggle(): Promise<void> {
		if (!isExternalFeaturesEnabled()) return;

		if (this.enabled) {
			this.disable();
			return;
		}

		this.blocked = false;
		this.updateButton();

		const lang = await ensureTranslationLangConfigured();
		if (!lang) return;

		this.cachedTargetLang = lang;
		this.enabled = true;
		this.updateButton();

		const channel = this.getChannel?.();
		if (channel) this.scheduleChannel(channel, 0);
	}

	static onAuthRequired(channel?: Channel, messageId?: string): void {
		this.onBlocked();
		const ch = channel || this.getChannel?.();
		handleTranslationError(new SovrahiRequiresKeycloakError(), {
			channel: ch,
			messageId,
			silent: true,
		});
	}

	static promptReconnect(): void {
		this.onAuthRequired(this.getChannel?.());
	}

	static onMessageVisible(channel: Channel, _messageId: string): void {
		if (!this.enabled || channel.localuser.channelfocus !== channel) return;
		this.scheduleChannel(channel);
	}

	static onChannelFocused(channel: Channel): void {
		if (!this.enabled) return;
		this.scheduleChannel(channel, 0);
	}

	static scheduleChannel(channel: Channel, delay = SCROLL_SETTLE_MS): void {
		if (!this.enabled) return;
		if (this.scheduleTimer) clearTimeout(this.scheduleTimer);
		this.scheduleTimer = setTimeout(() => {
			this.scheduleTimer = undefined;
			void this.processChannel(channel);
		}, delay);
	}

	private static async processChannel(channel: Channel): Promise<void> {
		if (!this.enabled || channel.localuser.channelfocus !== channel) return;
		if (this.processing && this.activeChannelId === channel.id) return;

		const settled = await waitForScrollSettle(channel);
		if (!settled || !this.enabled) return;

		const targetLang = this.cachedTargetLang || (await getTranslationLang());
		if (!targetLang) return;

		this.processing = true;
		this.activeChannelId = channel.id;

		try {
			while (this.enabled && channel.localuser.channelfocus === channel) {
				if (channel.infinite.scrolling) {
					await waitForScrollSettle(channel);
					if (!this.enabled) break;
				}

				const visibleIds = sortIdsNewestFirst(channel.infinite.getVisibleIds());
				const candidates: Message[] = [];
				for (const id of visibleIds) {
					const message = channel.messages.get(id);
					if (message?.canAutoTranslate(targetLang)) {
						candidates.push(message);
					}
				}
				if (!candidates.length) break;

				const batchMessages = candidates.slice(0, BATCH_SIZE);
				for (const message of batchMessages) {
					message.markTranslationLoading(targetLang);
				}

				try {
					const outcomes = await TranslationService.translateBatch(
						batchMessages.map((message) => ({
							id: message.id,
							raw: message.content.rawString,
						})),
						targetLang,
					);
					for (const message of batchMessages) {
						const outcome = outcomes.get(message.id);
						if (outcome) {
							message.applyTranslation(outcome.text, outcome.sourceLang, targetLang);
							this.autoTranslatedIds.add(message.id);
						} else {
							message.clearTranslationLoading();
						}
					}
				} catch (error) {
					for (const message of batchMessages) {
						message.clearTranslationLoading();
					}
					handleTranslationError(error, {
						channel,
						silent: true,
						onAuthRequired: () => this.onAuthRequired(channel),
						onBlocked: () => this.onBlocked(),
					});
					return;
				}

				const remaining = candidates.length > BATCH_SIZE;
				if (!remaining) break;
				await wait(BATCH_DELAY_MS);
			}
		} finally {
			this.processing = false;
			if (this.activeChannelId === channel.id) {
				this.activeChannelId = undefined;
			}
		}
	}
}
