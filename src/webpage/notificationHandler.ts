import {Channel} from "./channel.js";
import {I18n} from "./i18n.js";
import {Message} from "./message.js";
import {SW} from "./utils/utils.js";

declare global {
	interface NotificationOptions {
		image?: string | null | undefined;
	}
}
export class NotificationHandler {
	static makeIcon(message: Message) {
		return message.author.getpfpsrc(message.guild);
	}
	/** False once the page has been refused `new Notification` (Android Chrome). */
	static constructorWorks = true;
	/** Taps on worker-shown notifications reach the page by tag (service.ts, notificationclick). */
	static clickHandlers = new Map<string, () => void>();
	static listeningForClicks = false;
	/**
	 * Shows a notification, through a service worker registration where the page may not
	 * construct one. Resolves to something closable when the browser hands one back.
	 */
	static async show(
		title: string,
		options: NotificationOptions & {tag: string},
		channel: Channel,
		onClick: () => void,
	): Promise<Notification | undefined> {
		if (this.constructorWorks) {
			try {
				const notification = new Notification(title, options);
				notification.addEventListener("click", (_) => {
					window.focus();
					onClick();
				});
				return notification;
			} catch (e) {
				if (!(e instanceof TypeError)) throw e;
				this.constructorWorks = false;
			}
		}
		const registration = await SW.notificationRegistration();
		this.listenForClicks();
		this.clickHandlers.set(options.tag, onClick);
		// Notifications dismissed without a tap leave their handler behind; keep the newest.
		if (this.clickHandlers.size > 100) {
			this.clickHandlers.delete(this.clickHandlers.keys().next().value!);
		}
		// The url opens the channel when no window of the app is left to hand the tap to; the
		// channel id, when the window that gets it kept no handler (it loaded since).
		const url = "/channels/" + channel.guild_id + "/" + channel.id;
		await registration.showNotification(title, {...options, data: {url, channelId: channel.id}});
		return (await registration.getNotifications({tag: options.tag}))[0];
	}
	/** Opens a channel for a tap this page kept no handler for (set by the app at start). */
	static openChannel?: (channelId: string) => void;
	static listenForClicks() {
		// Insecure origins (plain-http LAN dev) have no service workers at all.
		if (this.listeningForClicks || !("serviceWorker" in navigator)) return;
		this.listeningForClicks = true;
		navigator.serviceWorker.addEventListener("message", (e) => {
			if (e.data?.code !== "notificationClick") return;
			const onClick = this.clickHandlers.get(e.data.tag);
			this.clickHandlers.delete(e.data.tag);
			if (onClick) onClick();
			else if (typeof e.data.channelId === "string") this.openChannel?.(e.data.channelId);
		});
	}
	static channelMap = new Map<Channel, Set<{close(): void}>>();
	static async sendMessageNotification(message: Message) {
		const html = message.content.makeHTML();
		await new Promise<void>((res) => res());
		let noticontent: string | undefined | null = html.textContent;
		if (message.embeds[0]) {
			noticontent ||= message.embeds[0]?.json.title;
			noticontent ||= message.content.textContent;
		}
		noticontent ||= I18n.blankMessage();

		const image = message.getimages()[0];
		const imgurl = image?.proxy_url || image?.url || undefined;
		// Deciding to clump and counting this notification happen in one synchronous run, before
		// the (on Android, slow) show, so a burst of messages still clumps; a clump that closes
		// the slot early closes the notification once it exists.
		const clump = this.groupNotifs(message);
		if (clump) return void (await clump);
		const channelSet = this.channelMap.get(message.channel) || new Set();
		this.channelMap.set(message.channel, channelSet);
		let notification: Notification | undefined;
		let closed = false;
		const slot = {
			close() {
				closed = true;
				notification?.close();
			},
		};
		channelSet.add(slot);
		setTimeout(() => {
			channelSet.delete(slot);
		}, 4000);
		notification = await this.show(
			message.channel.notititle(message),
			{
				body: noticontent,
				icon: this.makeIcon(message),
				image: imgurl,
				silent: true,
				tag: message.id,
			},
			message.channel,
			() => message.channel.getHTML(true, true),
		);
		if (closed) notification?.close();
	}
	static channelSuperMap = new Map<Channel, [number, NodeJS.Timeout, number]>();
	/** False, or the clump's show when the message joins its channel's clump. */
	static groupNotifs(message: Message): false | Promise<unknown> {
		let sup = this.channelSuperMap.get(message.channel);

		const notiSet = this.channelMap.get(message.channel);
		if (!notiSet) return false;
		if (!sup) {
			if (notiSet.size < 4) return false;
			// Counts the notifications it replaces; this message adds itself below.
			sup = [notiSet.size, 0 as any, Math.random()];
			this.channelSuperMap.set(message.channel, sup);
		}

		[...notiSet].forEach((_) => _.close());

		const clump = sup;
		const count = ++clump[0];
		const rand = clump[2];
		// Each message restarts the clump's 3 s: an earlier message's timer must not end it.
		// Set before the show, which can be slow or fail: the clump must still end. A clump
		// ended by a tap may already be replaced by a newer one, which its timer leaves alone.
		clearTimeout(clump[1]);
		clump[1] = setTimeout(() => {
			if (this.channelSuperMap.get(message.channel) === clump) {
				this.channelSuperMap.delete(message.channel);
			}
		}, 3000);
		return this.show(
			message.channel.notititle(message),
			{
				body: I18n.notiClump(count + "", message.channel.name),
				icon: this.makeIcon(message),
				silent: true,
				tag: message.channel.id + rand,
			},
			message.channel,
			() => {
				message.channel.getHTML(true, true);
				this.channelSuperMap.delete(message.channel);
			},
		);
	}
}
