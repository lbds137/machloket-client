import {Message} from "./message.js";
import {Contextmenu} from "./contextmenu.js";
import {Guild, makeInviteMenu} from "./guild.js";
import {Localuser} from "./localuser.js";
import {Permissions} from "./permissions.js";
import {Dialog, Float, Settings} from "./settings.js";
import {Role, RoleList} from "./role.js";
import {InfiniteScroller} from "./infiniteScroller.js";
import {SnowFlake} from "./snowflake.js";
import {closeMembersOnNavigation} from "./utils/membersView.js";
import {closeSearchOnNavigation} from "./utils/searchView.js";
import {
	channeljson,
	creatPollJSON,
	embedjson,
	filejson,
	memberjson,
	messageCreateJson,
	messagejson,
	mute_config,
	readyjson,
	startTypingjson,
	tagjson,
	threadMember,
	threadMetadata,
} from "./jsontypes.js";
import {MarkDown, saveCaretPosition} from "./markdown.js";
import {Member} from "./member.js";
import {Voice} from "./voice.js";
import {User, userVolMenu} from "./user.js";
import {I18n} from "./i18n.js";
import {getViewportHeight, mobile, createImg, safeImg} from "./utils/utils.js";
import {webhookMenu} from "./webhooks.js";
import {File} from "./file.js";
import {Sticker} from "./sticker.js";
import {CustomHTMLDivElement} from "./index.js";
import {NotificationHandler} from "./notificationHandler.js";
import {Command} from "./interactions/commands.js";
import {wireGuildId} from "./interactions/compontents.js";
import {Tag} from "./tag.js";
import {CDNParams} from "./utils/cdnParams.js";
import {NotificationSoundManager} from "./utils/notificationSound.js";
import {fetchRetryOnce, retryAfterMs, retryAfterMsFromBody} from "./utils/rateLimit.js";
import {hideNotifyBanner} from "./notifyBanner.js";
import {holdsInviteLink, showNewInvite} from "./utils/inviteLink.js";
import {getSensitiveContentSync} from "./utils/sensitiveContent.js";
import {formErrors, refusalText, showRefusal} from "./utils/showRefusal.js";
import {resolveTypedMentions} from "./utils/typedMentions.js";

const FORUM_MESSAGE_PREVIEW_MAX_LENGTH = 200;

let shortRev: Promise<string> | undefined;
/** Unique per send: the server answers a repeated nonce with the earlier message, so two sends
 * within a second must not share one. */
export async function createMachloketNonce(): Promise<string> {
	shortRev ??= fetch("/getupdates")
		.then((res) => res.text())
		.then((rev) => rev.slice(0, 7))
		.catch(() => {
			// Offline: no revision, and the next send asks again.
			shortRev = undefined;
			return "unknown";
		});
	const unique = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
	return btoa(`machloket-${await shortRev}|${Math.floor(Date.now() / 1000)}|${unique}`);
}

/**
 * A refused send's reason as the user should read it: an invalid form (50035) says what was
 * wrong (its nested `errors[...]._errors[].message`, e.g. a too-long message), anything else the
 * server's message, or a generic line when the body has none.
 */
function sendErrorText(body: {code?: number; message?: unknown; errors?: unknown} | null): string {
	if (body?.code === 50035) {
		const found = formErrors(body.errors);
		if (found.length) return found.join(" ");
	}
	return typeof body?.message === "string" && body.message
		? body.message
		: I18n.channel.sendFailed();
}

/** Releases everyone waiting on a history page that won't come. */
function settleWaiters(waiters: Map<string, () => void>) {
	for (const res of waiters.values()) res();
	waiters.clear();
}

/** Bits that only qualify a message being sent: lost, like the server drops them, without SEND_MESSAGES. */
const sendDependent = new Set([
	"MENTION_EVERYONE",
	"SEND_TTS_MESSAGES",
	"ATTACH_FILES",
	"EMBED_LINKS",
]);

class Channel extends SnowFlake {
	editing!: Message | null;
	type!: number;
	owner!: Guild;
	headers!: Localuser["headers"];
	name!: string;
	parent_id?: string | null;
	parent: Channel | null | undefined;
	children!: Channel[];
	guild_id!: string;
	permission_overwrites!: Map<string, Permissions>;
	permission_overwritesar: [string, Permissions][] = [];
	topic!: string;
	nsfw!: boolean;
	position: number = 0;
	private lastreadmessageidint?: string;
	get lastreadmessageid() {
		return this.lastreadmessageidint;
	}
	async getOverwrites(): Promise<[User | Role, Permissions][]> {
		return await Promise.all(
			this.permission_overwritesar.map(async ([id, p]) => {
				const role = this.guild.roleids.get(id);
				if (role) return [role, p] as const;
				return [await this.localuser.getUser(id), p] as const;
			}),
		);
	}
	set lastreadmessageid(id: string | undefined) {
		const cur = this.lastreadmessageidint;
		this.lastreadmessageidint = id;
		if (!this.isChatViewActive()) return;
		const m = this.messages.get(this.idToNext.get(cur as string) as string);
		if (m) {
			m.generateMessage();
		}
		const m2 = this.messages.get(this.idToNext.get(id as string) as string);
		if (m2) {
			m2.generateMessage();
		}
	}
	lastmessageid?: string;
	trueLastMessageid?: string;
	rate_limit_per_user: number = 0;
	mentions = 0;
	lastpin!: string;
	move_id?: string | null;
	typing!: number;
	message_notifications: number = 3;
	allthewayup!: boolean;
	static contextmenu = new Contextmenu<Channel, undefined>("channel menu");

	static clearScrollWrapLeaks() {
		const messages = document.getElementById("scrollWrap");
		if (!messages) return;
		for (const elm of Array.from(messages.getElementsByClassName("scroller"))) {
			elm.remove();
		}
	}

	isChatViewActive(): boolean {
		if (this.localuser.channelfocus !== this) return false;
		const div = this.infinite.div;
		if (!div?.isConnected) return false;
		if (mobile) {
			const maintoggle = document.getElementById("maintoggle") as HTMLInputElement | null;
			if (maintoggle && !maintoggle.checked) return false;
		}
		return true;
	}

	private onReachedBottom() {
		if (!this.isChatViewActive()) return;
		this.readbottom();
	}
	replyingto!: Message | null;
	infinite!: InfiniteScroller;
	idToPrev: Map<string, string | undefined>;
	idToNext: Map<string, string | undefined>;
	messages: Map<string, Message>;
	voice?: Voice;
	bitrate: number = 128000;
	threadData?: threadMetadata;
	mute_config: mute_config | null = {selected_time_window: -1, end_time: 0};
	updateEvents = new Set<() => void>();
	fireEvents() {
		for (const thing of this.updateEvents) {
			thing();
		}
	}
	setLastMessageId(id: string) {
		this.lastmessageid = id;
		try {
			if (BigInt(id) > BigInt(this.trueLastMessageid || "0")) {
				this.trueLastMessageid = id;
			}
		} catch {}
	}
	handleUserOverrides(settings: {
		message_notifications: number;
		muted: boolean;
		mute_config: mute_config | null;
		channel_id: string;
	}) {
		this.message_notifications = settings.message_notifications;
		this.mute_config = settings.mute_config;
	}
	static setupcontextmenu() {
		this.contextmenu.addButton(
			() => I18n.channel.markRead(),
			function (this: Channel) {
				this.readbottom();
			},
		);

		this.contextmenu.addButton(
			() => I18n.channel.makeInvite(),
			function (this: Channel) {
				this.createInvite();
			},
			{
				visible: function () {
					return this.hasPermission("CREATE_INSTANT_INVITE") && this.type !== 4 && !this.isThread();
				},
				icon: {
					css: "svg-userplus",
				},
				color: "blue",
			},
		);
		this.contextmenu.addSeperator();
		this.contextmenu.addButton(
			() => I18n.threads.leave(),
			async function () {
				const res = await fetch(this.info.api + "/channels/" + this.id + "/thread-members/@me", {
					method: "DELETE",
					headers: this.headers,
				}).catch(() => undefined);
				if (!res?.ok) await showRefusal(res);
			},
			{
				visible: function () {
					return this.isThread() && !!this.member;
				},
			},
		);

		this.contextmenu.addButton(
			() => I18n.threads.join(),
			async function () {
				const res = await fetch(this.info.api + "/channels/" + this.id + "/thread-members/@me", {
					method: "POST",
					headers: this.headers,
				}).catch(() => undefined);
				if (!res?.ok) await showRefusal(res);
			},
			{
				visible: function () {
					return this.isThread() && !this.member;
				},
			},
		);

		this.contextmenu.addButton(
			() => I18n.threads.editTags(),
			function () {
				this.editTags();
			},
			{
				visible: function () {
					return !!(this.isThread() && this.parent?.isForum() && this.parent.availableTags);
				},
			},
		);

		this.contextmenu.addSeperator();
		this.contextmenu.addButton(
			() => I18n.guild.notifications(),
			function () {
				this.setnotifcation();
			},
			{
				icon: {
					css: "svg-bell",
				},
			},
		);
		this.contextmenu.addButton(
			() => I18n.channel.moveTo(),
			function () {
				this.moveToMenu();
			},
			{
				visible: function () {
					// Managers only (drag's own gate is isAdmin — the filed drag unit carries
					// the question of widening it). No threads; nothing to offer without
					// categories unless the channel can leave the one it is in.
					return (
						this.type !== 4 &&
						!this.isThread() &&
						this.hasPermission("MANAGE_CHANNELS") &&
						(!!this.parent || this.guild.headchannels.some((c) => c.type === 4))
					);
				},
			},
		);
		this.contextmenu.addButton(
			() => I18n.channel.mute(),
			function () {
				this.muteChannel();
			},
			{
				visible: function () {
					return !this.muted && this.type !== 4;
				},
			},
		);
		this.contextmenu.addButton(
			() => I18n.channel.unmute(),
			function () {
				this.unmuteChannel();
			},
			{
				visible: function () {
					return this.muted;
				},
			},
		);

		this.contextmenu.addButton(
			() => I18n.channel.settings(),
			function (this: Channel) {
				this.generateSettings();
			},
			{
				visible: function () {
					return (
						this.hasPermission("MANAGE_CHANNELS") ||
						this.owner_id === this.localuser.user.id
					);
				},
				icon: {
					css: "svg-settings",
				},
			},
		);

		this.contextmenu.addButton(
			function () {
				if (this.isThread()) {
					return I18n.channel.deleteThread();
				}
				if (this.type === 4) {
					return I18n.channel.deleteCat();
				}
				return I18n.channel.delete();
			},
			function (this: Channel) {
				this.deleteChannel();
			},
			{
				visible: function () {
					return this.isThread()
						? this.hasPermission("MANAGE_THREADS")
						: this.hasPermission("MANAGE_CHANNELS");
				},
				icon: {
					css: "svg-delete",
				},
				color: "red",
			},
		);

		this.contextmenu.addSeperator();
		this.contextmenu.addButton(
			function () {
				if (this.type == 4) {
					return I18n.channel.copyIdCat();
				}
				return I18n.channel.copyId();
			},
			function (this: Channel) {
				navigator.clipboard.writeText(this.id);
			},
			{
				icon: {
					css: "svg-hash",
				},
			},
		);
	}
	/** Counts this channel's mute and unmute PATCHes, so a newer one cancels an older one's 429 retry. */
	private muteSeq?: number;
	/** While mute changes are in flight: the config the server last accepted (boxed: it may be
	 * null), so a refusal goes back to it rather than to an earlier unanswered change. */
	private acceptedMute?: {config: mute_config | null; inFlight: number};
	/** Sends a mute or unmute override; if the latest change is refused, the channel goes back to
	 * the config the server holds. Call it before applying `mute_config` locally. */
	private async sendMuteConfig(muted: boolean, mute_config: mute_config, seq: number) {
		// With nothing in flight, the config shown is the server's (a gateway update may have set it).
		const accepted = (this.acceptedMute ??= {config: this.mute_config, inFlight: 0});
		accepted.inFlight++;
		const res = await fetchRetryOnce(
			this.info.api + "/users/@me/guilds/" + this.guild.id + "/settings",
			{
				method: "PATCH",
				headers: this.headers,
				body: JSON.stringify({
					channel_overrides: {
						[this.id]: {
							message_notifications: this.message_notifications,
							muted,
							mute_config,
							channel_id: this.id,
						},
					},
				}),
			},
			{shouldRetry: () => seq === this.muteSeq},
		).catch(() => undefined);
		if (--accepted.inFlight === 0) this.acceptedMute = undefined;
		if (res?.ok) {
			accepted.config = mute_config;
		} else if (seq === this.muteSeq) {
			this.mute_config = accepted.config;
			this.showMuteState();
			this.unreads();
			this.guild.unreads();
			await showRefusal(res);
		}
	}
	unmuteChannel() {
		const seq = (this.muteSeq = (this.muteSeq ?? 0) + 1);
		const mute_config = {
			selected_time_window: -1,
			end_time: 0,
		};
		const req = this.sendMuteConfig(false, mute_config, seq);
		this.mute_config = mute_config;
		this.showMuteState();
		this.unreads();
		this.guild.unreads();
		return req;
	}
	muteChannel() {
		const dio = new Dialog(I18n.channel.mute());
		const opt = dio.options;
		let time = 1800;
		opt.addSelect(
			I18n.muteDuration(),
			() => {},
			(["30m", "1h", "6h", "12h", "1d", "7d", "30d", "never"] as const).map((e) =>
				I18n.inviteOptions[e](),
			),
		).onchange = (e) => {
			time = [1800, 3600, 21600, 43200, 86400, 604800, 2592000, 1 << 30][e];
		};
		opt.addButtonInput("", I18n.submit(), () => {
			const seq = (this.muteSeq = (this.muteSeq ?? 0) + 1);
			const mute_config = {
				selected_time_window: time,
				end_time: Math.floor(new Date(Date.now() + time * 1000).getTime()),
			};
			const req = this.sendMuteConfig(true, mute_config, seq);
			this.mute_config = mute_config;
			this.showMuteState();
			dio.hide();
			this.unreads();
			this.guild.unreads();
			return req;
		});
		dio.show();
	}
	moveInto(dest: Channel | null): boolean {
		// Places at the end of dest; coatDropDiv's container drop places at the top.
		if ((this.parent ?? null) === dest) return false;
		const from = this.parent ? this.parent.children : this.guild.headchannels;
		const idx = from.indexOf(this);
		if (idx !== -1) from.splice(idx, 1);
		if (dest) {
			this.move_id = dest.id;
			this.parent = dest;
			this.parent_id = dest.id;
			dest.children.push(this);
		} else {
			// Discord renders uncategorised channels above the categories.
			this.move_id = undefined;
			this.parent = null;
			this.parent_id = null;
			const firstCat = this.guild.headchannels.findIndex((c) => c.type === 4);
			if (firstCat === -1) this.guild.headchannels.push(this);
			else this.guild.headchannels.splice(firstCat, 0, this);
		}
		return true;
	}
	moveToMenu() {
		const dio = new Dialog(I18n.channel.moveTo());
		const opt = dio.options;
		const cats = this.guild.headchannels.filter((c) => c.type === 4);
		const dests: (Channel | null)[] = [...cats, null];
		const labels = [...cats.map((c) => c.name), I18n.channel.noCategory()];
		const cur = dests.indexOf(this.parent ?? null);
		let picked = cur >= 0 ? cur : dests.length - 1;
		opt.addSelect(I18n.channel.moveTo(), () => {}, labels, {
			defaultIndex: picked,
			radio: true,
		}).onchange = (i) => {
			picked = i;
		};
		opt.addButtonInput("", I18n.submit(), () => {
			const dest = dests[picked] ?? null;
			// Bail before snapshotting: a no-op submit must not bump layoutSeq — that would
			// disarm an in-flight drag's restore (the drop handler orders the same way).
			if ((this.parent ?? null) === dest) {
				dio.hide();
				return;
			}
			const restore = this.guild.snapshotLayout();
			this.moveInto(dest);
			const guild = this.guild;
			void guild.calculateReorder(this.id, restore);
			// The drag path moves the DOM row itself; move-to redraws from the model at
			// once, the way snapshotLayout's restore does — the gateway echo can lag.
			if (guild.localuser.lookingguild === guild) {
				const channels = document.getElementById("channels");
				if (channels) {
					channels.innerHTML = "";
					channels.appendChild(guild.buildChannelList());
				}
			}
			dio.hide();
		});
		dio.show();
	}
	get muted() {
		return !!this.mute_config && new Date(this.mute_config.end_time).getTime() > Date.now();
	}
	private muteTimer?: ReturnType<typeof setTimeout>;
	/** Shows the row muted while the mute lasts, and unmuted once it runs out. */
	private showMuteState(div = this.html?.deref()) {
		clearTimeout(this.muteTimer);
		if (!div) return;
		div.classList.toggle("muted", this.muted);
		if (!this.muted) return;
		const left = new Date(this.mute_config!.end_time).getTime() - Date.now();
		// A timer can't wait past 2^31-1 ms (~24.8 days): a longer mute checks again then.
		this.muteTimer = setTimeout(() => this.showMuteState(), Math.min(left, 2 ** 31 - 1));
	}
	icon?: string;
	iconUrl() {
		return (
			`${this.info.cdn}/channel-icons/${this.id}/${this.icon}.png` +
			new CDNParams({expectedSize: 32})
		);
	}
	createInvite() {
		const div = document.createElement("div");
		div.classList.add("invitediv");
		const text = document.createElement("span");
		text.classList.add("ellipsis");
		div.append(text);
		let uses = 0;
		let expires = 1800;
		const copycontainer = document.createElement("div");
		copycontainer.classList.add("copycontainer");
		const copy = document.createElement("span");
		copy.classList.add("copybutton", "svgicon", "svg-copy");
		copycontainer.append(copy);
		copycontainer.onclick = (_) => {
			if (holdsInviteLink(text)) {
				navigator.clipboard.writeText(text.textContent!);
			}
		};
		div.append(copycontainer);
		const update = () => {
			void showNewInvite(
				`${this.info.api}/channels/${this.id}/invites`,
				this.headers,
				{max_age: expires, max_uses: uses},
				this.info.wellknown,
				text,
			);
		};
		update();
		const inviteOptions = new Dialog("", {noSubmit: true});
		inviteOptions.options.addTitle(I18n.inviteOptions.title());
		inviteOptions.options.addText(I18n.invite.subtext(this.name, this.guild.properties.name));

		inviteOptions.options.addSelect(
			I18n.invite.expireAfter(),
			() => {},
			(["30m", "1h", "6h", "12h", "1d", "7d", "30d", "never"] as const).map((e) =>
				I18n.inviteOptions[e](),
			),
		).onchange = (e) => {
			expires = [1800, 3600, 21600, 43200, 86400, 604800, 2592000, 0][e];
			update();
		};

		const timeOptions = (["1", "5", "10", "25", "50", "100"] as const).map((e) =>
			I18n.inviteOptions.limit(e),
		);
		timeOptions.unshift(I18n.inviteOptions.noLimit());
		inviteOptions.options.addSelect(I18n.invite.expireAfter(), () => {}, timeOptions).onchange = (
			e,
		) => {
			uses = [0, 1, 5, 10, 25, 50, 100][e];
			update();
		};

		inviteOptions.options.addHTMLArea(div);
		inviteOptions.show();
	}
	generateSettings() {
		this.sortPerms();
		const settings = new Settings(I18n.channel.settingsFor(this.name));
		{
			const gensettings = settings.addButton(I18n.channel.settings());
			const form = gensettings.addForm("", () => {}, {
				fetchURL: this.info.api + "/channels/" + this.id,
				method: "PATCH",
				headers: this.headers,
				traditionalSubmit: true,
			});
			form.addTextInput(I18n.channel["name:"](), "name", {
				initText: this.name,
			});
			form.addMDInput(I18n.channel["topic:"](), "topic", {
				initText: this.topic,
			});
			form.addImageInput(I18n.channel.icon(), "icon", {
				initImg: this.icon ? this.iconUrl() : undefined,
				clear: true,
			});
			form.addCheckboxInput(I18n.channel["nsfw:"](), "nsfw", {
				initState: this.nsfw,
			});
			const times = [
				0,
				5,
				10,
				15,
				30,
				60,
				120,
				300,
				600,
				900,
				1800,
				60 * 60,
				60 * 60 * 2,
				60 * 60 * 6,
			];
			form.addSelect(
				I18n.channel.slowmode(),
				"rate_limit_per_user",
				["0s", "5s", "10s", "15s", "30s", "1m", "2m", "5m", "10m", "15m", "30m", "1h", "2h", "6h"],
				{
					defaultIndex: (times.findIndex((_) => _ === this.rate_limit_per_user) + 1 || 1) - 1,
				},
				times,
			);
			const arcTimes = [60, 60 * 24, 60 * 24 * 3, 60 * 24 * 7];
			form.addSelect(
				I18n.channel.hideThreads(),
				"default_auto_archive_duration",
				["1h", "24h", "3d", "7d"],
				{
					defaultIndex: arcTimes.findIndex((_) => _ === (this.defaultAutoArchiveDuration ?? 1440)),
				},
				arcTimes,
			);
			if (this.isForum()) {
				form.addText(I18n.forum.settings.editTags());
				const tags = document.createElement("div");
				tags.classList.add("forumTagSelect");
				const tagSet = new Set<string>();
				const makeTagHTML = (tag: Tag) => {
					tagSet.add(tag.id);
					let html = tag.makeHTML();
					html.onclick = () => {
						const d = new Dialog(I18n.forum.settings.editTag());
						const f = d.options.addForm(
							"",
							(_, obj) => {
								tag.update(obj as tagjson);
								const newhtml = tag.makeHTML();
								html.parentNode?.insertBefore(newhtml, html);
								html.remove();
								newhtml.onclick = html.onclick;
								html = newhtml;
								d.hide();
							},
							{
								fetchURL: this.info.api + "/channels/" + this.id + "/tags/" + tag.id,
								method: "PUT",
								headers: this.headers,
							},
						);
						f.addTextInput(I18n.forum.settings.tagName(), "name", {
							initText: tag.name,
						});
						f.addCheckboxInput(I18n.forum.settings.moderated(), "moderated", {
							initState: tag.moderated,
						});
						f.addButtonInput("", I18n.forum.settings.delTag(), async () => {
							const res = await fetch(this.info.api + "/channels/" + this.id + "/tags/" + tag.id, {
								method: "DELETE",
								headers: this.headers,
							}).catch(() => undefined);
							if (res?.ok) {
								d.hide();
								html.remove();
							} else {
								await showRefusal(res);
							}
						});
						d.show();
					};
					tags.append(html);
				};
				for (const tag of this.availableTags) {
					makeTagHTML(tag);
				}
				form.addHTMLArea(tags);
				form.addButtonInput("", I18n.forum.settings.addTag(), () => {
					const d = new Dialog(I18n.forum.settings.editTag());
					const f = d.options.addForm(
						"",
						(json) => {
							const channel = json as channeljson;
							if (!channel.available_tags) return;
							const dontHave = channel.available_tags.filter((_) => !tagSet.has(_.id));
							for (const tagJson of dontHave) {
								makeTagHTML(new Tag(tagJson, this));
							}
							d.hide();
						},
						{
							fetchURL: this.info.api + "/channels/" + this.id + "/tags",
							method: "POST",
							headers: this.headers,
						},
					);
					f.addTextInput(I18n.forum.settings.tagName(), "name", {
						initText: "",
					});
					f.addCheckboxInput(I18n.forum.settings.moderated(), "moderated", {
						initState: false,
					});
					d.show();
				});
			}
			if (this.type !== 4 && !this.isThread() && !this.isForum()) {
				const options = ["voice", "text", "announcement"] as const;
				form.addSelect(
					I18n.channel["type:"](),
					"type",
					options.map((e) => I18n.channel[e]()),
					{
						defaultIndex: options.indexOf(
							{0: "text", 2: "voice", 5: "announcement", 4: "category"}[this.type] as
								| "text"
								| "voice"
								| "announcement",
						),
					},
					options,
				);
				form.addPreprocessor((obj: any) => {
					obj.type = {text: 0, voice: 2, announcement: 5, category: 4}[obj.type as string];
				});
			}
		}
		if (this.type === 4) {
			const syncSection = settings.addButton(I18n.channel.syncPerms());
			syncSection.addText(I18n.channel.syncPermsDesc());
			syncSection.addButtonInput("", I18n.channel.syncPermsConfirm(), () => {
				const d = new Dialog(I18n.channel.syncPermsTitle());
				const descDiv = document.createElement("div");
				descDiv.textContent = I18n.channel.syncPermsDesc();
				d.options.addHTMLArea(descDiv);
				d.options.addButtonInput("", I18n.channel.syncPermsConfirm(), () => {
					d.hide();
					void this.syncPermsToChildren();
				});
				d.options.addButtonInput("", I18n.channel.syncPermsCancel(), () => {
					d.hide();
				});
				d.show();
			});
		}
		if (!this.isThread()) {
			const s1 = settings.addButton(I18n.channel.permissions(), {optName: ""});

			(async () => {
				const list = await this.getOverwrites();
				// A channel with no overwrites still offers @everyone to edit; nothing is written
				// until an edit is saved.
				if (list.length === 0) {
					const everyone = this.guild.roleids.get(this.guild.id);
					if (everyone) list.push([everyone, new Permissions("0", "0")]);
				}

				s1.options.push(
					new RoleList(list, this.guild, this.updateRolePermissions.bind(this), this),
				);
			})();
			const inviteMenu = settings.addButton(I18n.guild.invites());
			makeInviteMenu(inviteMenu, this.owner, this.info.api + `/channels/${this.id}/invites`);

			const webhooks = settings.addButton(I18n.webhooks.base());
			webhookMenu(this.guild, this.info.api + `/channels/${this.id}/webhooks`, webhooks, this.id);
		}

		settings.show();
	}
	sortPerms() {
		this.permission_overwritesar.sort((a, b) => {
			if (!this.guild.hasRole(a[0])) return -1;
			if (!this.guild.hasRole(b[0])) return 1;
			return (
				this.guild.roles.findIndex((r) => r.id === a[0]) -
				this.guild.roles.findIndex((r) => r.id === b[0])
			);
		});
	}
	setUpInfiniteScroller() {
		this.infinite = new InfiniteScroller(
			async (id: string, offset: number): Promise<string | undefined> => {
				if (offset === 1) {
					if (this.idToPrev.has(id)) {
						return this.idToPrev.get(id);
					} else {
						const failures = this.historyFailures;
						await this.grabBefore(id);
						// A failed page isn't the top of the channel: the scroller retries later.
						// (Any failure while this caller waited counts: a second caller shares the
						// first one's fetch, and a pending send's id pages from a real one.)
						if (!this.idToPrev.has(id) && this.historyFailures !== failures) {
							throw new Error("history page failed");
						}
						return this.idToPrev.get(id);
					}
				} else {
					if (this.idToNext.has(id)) {
						return this.idToNext.get(id);
					} else if (this.lastmessage?.id !== id) {
						const failures = this.historyFailures;
						await this.grabAfter(id);
						if (!this.idToNext.has(id) && this.historyFailures !== failures) {
							throw new Error("history page failed");
						}
						return this.idToNext.get(id);
					} else {
					}
				}
				return undefined;
			},
			(id: string): HTMLElement => {
				//await new Promise(_=>{setTimeout(_,Math.random()*10)})
				const message = this.messages.get(id);
				try {
					if (message) {
						const html = this.fakeMessages.get(message);
						if (html) {
							return html;
						}
						return message.buildhtml();
					} else {
						console.error(id + " not found");
					}
				} catch (e) {
					console.error(e);
				}
				return document.createElement("div");
			},
			async (id: string) => {
				const message = this.messages.get(id);
				try {
					if (message) {
						const html = this.fakeMessages.get(message);
						if (html) {
							html.remove();
							return true;
						}
						message.deleteDiv();
						return true;
					}
				} catch (e) {
					console.error(e);
				} finally {
				}
				return false;
			},
			this.onReachedBottom.bind(this),
		);
	}

	scrolling: boolean = false;

	last_pin_timestamp?: string;
	member?: threadMember;

	memberCount?: number;
	messageCount?: number;
	totalMessageSent?: number;
	availableTags: Tag[] = [];
	flags!: number;
	defaultAutoArchiveDuration!: number;

	constructor(json: channeljson | -1, owner: Guild, id: string = json === -1 ? "" : json.id) {
		super(id);
		this.idToNext = owner.localuser.idToNext;
		this.idToPrev = owner.localuser.idToPrev;
		this.messages = owner.localuser.messages;

		this.owner = owner;
		this.headers = this.owner.headers;

		if (json === -1) {
			return;
		}
		this.localuser.channelids.set(this.id, this);
		this.flags = json.flags || 0;
		this.memberCount = json.member_count;
		this.defaultAutoArchiveDuration = json.default_auto_archive_duration;
		this.appliedTags = json.applied_tags || [];
		this.availableTags = json.available_tags?.map((tag) => new Tag(tag, this)) || [];
		this.messageCount = json.message_count;
		this.totalMessageSent = json.total_message_sent;
		this.owner_id = json.owner_id;
		this.member = json.member;
		this.rate_limit_per_user = json.rate_limit_per_user || 0;
		this.editing;
		this.type = json.type;

		this.name = json.name;
		if (json.parent_id) {
			this.parent_id = json.parent_id;
		}
		this.parent = undefined;
		this.children = [];
		this.icon = json.icon;
		this.guild_id = json.guild_id;
		this.permission_overwrites = new Map();
		this.permission_overwrites = new Map();
		this.permission_overwritesar = (json.permission_overwrites ?? []).map((r) => {
			const p = new Permissions(r.allow, r.deny);
			this.permission_overwrites.set(r.id, p);
			return [r.id, p];
		});

		this.topic = json.topic;
		this.nsfw = json.nsfw;
		this.position = json.position;
		this.lastreadmessageid = undefined;
		if (json.last_message_id) {
			this.setLastMessageId(json.last_message_id);
		} else {
			this.lastmessageid = undefined;
		}
		if (this.type === 2 && this.localuser.voiceFactory) {
			this.voice = this.localuser.voiceFactory.makeVoice(this.guild.id, this.id, {
				bitrate: this.bitrate,
			});
			this.setUpVoice();
		}
		this.setUpInfiniteScroller();
		this.perminfo ??= {};
		this.threadData = json.thread_metadata;
		const read = this.localuser.unknownRead.get(this.id);
		if (read) {
			this.readStateInfo(read);
			this.localuser.unknownRead.delete(this.id);
		}
	}
	get perminfo() {
		return this.guild.perminfo.channels[this.id];
	}
	set perminfo(e) {
		this.guild.perminfo.channels[this.id] = e;
	}
	isAdmin() {
		return this.guild.isAdmin();
	}
	get guild() {
		return this.owner;
	}
	get localuser() {
		return this.guild.localuser;
	}
	get info() {
		return this.owner.info;
	}
	pinnedMessages?: Message[];
	/** This channel's pinned messages; a 429 waits and asks again once. Throws on an error
	 * answer or a non-list. */
	async fetchPinnedMessages(): Promise<messagejson[]> {
		const res = await fetchRetryOnce(`${this.info.api}/channels/${this.id}/pins`, {
			headers: this.headers,
		});
		if (!res.ok) throw new Error(`Loading pins answered ${res.status}`);
		const pinnedM = (await res.json()) as messagejson[];
		if (!Array.isArray(pinnedM)) throw new Error("Loading pins answered a non-list");
		return pinnedM;
	}
	async pinnedClick(rect: DOMRect) {
		const div = document.createElement("div");
		div.classList.add("flexttb", "pinnedMessages");
		div.style.top = rect.bottom + 20 + "px";
		div.style.right = window.innerWidth - rect.right + "px";
		document.body.append(div);
		Contextmenu.keepOnScreen(div);
		Contextmenu.declareMenu(div);
		this.last_pin_timestamp = this.lastpin;
		const l = (e: MouseEvent) => {
			if (e.target instanceof HTMLElement && div.contains(e.target)) {
				return;
			}
			div.remove();
			document.removeEventListener("mouseup", l);
		};
		document.addEventListener("mouseup", l);
		// The panel's one line of text: loading, a failure, or no pins.
		const status = document.createElement("b");
		status.classList.add("noPins");
		if (!this.pinnedMessages) {
			// The instance can take seconds to answer, so say so instead of showing an empty box.
			status.textContent = I18n.pinsLoading();
			div.append(status);
			try {
				const pinnedM = await this.fetchPinnedMessages();
				this.pinnedMessages = pinnedM.map((_) => {
					if (this.messages.has(_.id)) {
						return this.messages.get(_.id) as Message;
					} else {
						return new Message(_, this);
					}
				});
			} catch (e) {
				console.error(e);
				status.textContent = I18n.pinsLoadFailed();
				return;
			}
			status.remove();
		}
		const pinnedM = document.getElementById("pinnedMDiv");
		if (pinnedM) {
			pinnedM.classList.remove("unreadPin");
		}
		if (this.pinnedMessages.length === 0) {
			status.textContent = I18n.noPins();
			div.append(status);
			return;
		}
		div.append(
			...this.pinnedMessages.map((_) => {
				const html = _.buildhtml(undefined, true);
				html.style.cursor = "pointer";
				html.onclick = async () => {
					div.remove();
					await this.focus(_.id);
				};
				Message.contextmenu.bindContextmenu(html, _);
				return html;
			}),
		);
	}
	readStateInfo(json: readyjson["d"]["read_state"]["entries"][0]) {
		const next = this.messages.get(this.idToNext.get(this.lastreadmessageid as string) as string);
		this.lastreadmessageid = isNaN(+json.last_message_id) ? "0" : json.last_message_id;
		this.mentions = json.mention_count;
		this.mentions ??= 0;
		this.lastpin = json.last_pin_timestamp;
		if (next) {
			next.generateMessage();
		}
	}
	get hasunreads(): boolean {
		return this.unreadState();
	}
	private unreadState(): boolean {
		if (this.muted) return false;
		if (!this.hasPermission("VIEW_CHANNEL")) {
			return false;
		}
		if (this.mentions) return true;
		const readState = this.guild.localuser.ready?.d.read_state;
		if (!this.lastreadmessageid && readState && !readState.partial) {
			return false;
		}
		let lastreadmessage = SnowFlake.stringToUnixTime(this.lastreadmessageid || "0");
		if (this.guild.member) {
			const joinedAt = new Date(this.guild.member.joined_at).getTime();
			if (!lastreadmessage || lastreadmessage < joinedAt) {
				lastreadmessage = joinedAt;
			}
		}
		const lastmessage = SnowFlake.stringToUnixTime(this.trueLastMessageid || "0");
		return !!lastmessage && (!lastreadmessage || lastmessage > lastreadmessage) && this.type !== 4;
	}

	/** `sendBit` is the right to send that the bits qualifying a message depend on: a thread
	 * asks its parent with SEND_MESSAGES_IN_THREADS. */
	hasPermission(name: string, member = this.guild.member, sendBit = "SEND_MESSAGES"): boolean {
		if (!member) {
			return false;
		}
		if (member.isAdmin()) {
			return true;
		}
		// Only the owner and the role permission grant it; an overwrite can't.
		if (name === "ADMINISTRATOR") return false;
		if (this.isThread() && this.parent) {
			return this.parent.hasPermission(name, member, "SEND_MESSAGES_IN_THREADS");
		}
		if (member.commuicationDisabledLeft()) {
			const allowSet = new Set(["READ_MESSAGE_HISTORY", "VIEW_CHANNEL"]);
			if (!allowSet.has(name)) {
				return false;
			}
		}
		// The server's order: the roles' own permissions, then the @everyone overwrite, then the
		// member's other role overwrites together (an allow on any of them wins over a deny), then
		// the member's own overwrite.
		let allowed = member.roles.some((role) => role.permissions.getPermission(name) === 1);
		const everyone = this.permission_overwrites.get(this.guild.id)?.getPermission(name) ?? 0;
		if (everyone) allowed = everyone === 1;
		let roleDeny = false;
		let roleAllow = false;
		for (const role of member.roles) {
			if (role.id === this.guild.id) continue;
			const perm = this.permission_overwrites.get(role.id)?.getPermission(name) ?? 0;
			if (perm === 1) roleAllow = true;
			else if (perm === -1) roleDeny = true;
		}
		if (roleDeny) allowed = false;
		if (roleAllow) allowed = true;
		const own = this.permission_overwrites.get(member.id)?.getPermission(name) ?? 0;
		if (own) allowed = own === 1;
		if (!allowed) return false;
		// Implicit rules: a member who can't see the channel holds nothing in it, and without the
		// right to send, the bits that qualify a message are lost.
		if (name !== "VIEW_CHANNEL" && !this.hasPermission("VIEW_CHANNEL", member)) return false;
		if (sendDependent.has(name) && !this.hasPermission(sendBit, member)) return false;
		return true;
	}
	get canMessage(): boolean {
		return this.isThread()
			? this.hasPermission("SEND_MESSAGES_IN_THREADS")
			: this.hasPermission("SEND_MESSAGES");
	}
	sortchildren() {
		this.children.sort((a, b) => {
			return a.position - b.position;
		});
	}
	resolveparent(_guild: Guild = this.owner) {
		const parentid = this.parent_id;
		if (!parentid) return false;
		this.parent = this.localuser.channelids.get(parentid);
		this.parent ??= undefined;
		if (this.parent !== undefined) {
			this.parent.children.push(this);
		}
		return this.parent !== undefined;
	}
	calculateReorder(position: number) {
		const build: {
			id: string;
			position: number | undefined;
			parent_id: string | undefined;
		}[] = [];
		for (const thing of this.children) {
			const thisthing: {
				id: string;
				position: number | undefined;
				parent_id: string | undefined;
			} = {id: thing.id, position: undefined, parent_id: undefined};

			if (thing.position != position) {
				thisthing.position = thing.position = position;
			}
			if (thing.move_id) {
				// A pending parent move is consumed by the next reorder pass even when
				// it already matches parent_id (the model keeps parent_id current):
				// leaving it set would resurrect it after a gateway move by someone else.
				if (thing.move_id !== thing.parent_id) {
					thing.parent_id = thing.move_id;
					thisthing.parent_id = thing.parent?.id;
				}
				thing.move_id = undefined;
			}
			if (thisthing.position !== undefined || thisthing.parent_id) {
				build.push(thisthing);
			}
			position++;
		}
		return [build, position] as const;
	}
	static dragged: [Channel, HTMLDivElement] | [] = [];
	html: WeakRef<HTMLDivElement> | undefined;
	get visible() {
		return this.hasPermission("VIEW_CHANNEL");
	}
	voiceUsers = new WeakRef(document.createElement("div"));
	iconElm = new WeakRef(document.createElement("span") as HTMLSpanElement | safeImg);
	renderIcon() {
		let icon = this.iconElm.deref();
		if (this.icon && !this.localuser.perminfo.user.disableIcons) {
			if (icon instanceof HTMLImageElement) {
				icon.setSrcs(this.iconUrl());
			} else {
				const old = icon;
				const div = this.html?.deref();
				icon = createImg(this.iconUrl(), undefined, div, "icon");
				this.iconElm = new WeakRef(icon);
				if (old) {
					try {
						old.before(icon);
						old.remove();
					} catch {}
				}
			}
			icon.classList.add("space");
			return icon;
		} else if (!(icon instanceof HTMLSpanElement)) {
			const old = icon;
			icon = document.createElement("span");
			this.iconElm = new WeakRef(icon);
			if (old) {
				try {
					old.before(icon);
					old.remove();
				} catch {}
			}
		}
		icon.classList = "";
		if (this.type === 0) {
			if (this.guild.properties.rules_channel_id === this.id) {
				icon.classList.add("space", "svgicon", "svg-rules");
			} else {
				icon.classList.add("space", "svgicon", this.nsfw ? "svg-channelnsfw" : "svg-channel");
			}
		} else if (this.type === 2) {
			//
			icon.classList.add("space", "svgicon", this.nsfw ? "svg-voicensfw" : "svg-voice");
		} else if (this.type === 5) {
			//
			icon.classList.add("space", "svgicon", this.nsfw ? "svg-announcensfw" : "svg-announce");
		} else if (this.type === 15) {
			icon.classList.add("space", "svgicon", this.nsfw ? "svg-forumnsfw" : "svg-forum");
		}
		return icon;
	}
	isThread() {
		return this.type === 10 || this.type === 11 || this.type === 12;
	}
	createguildHTML(): HTMLDivElement {
		const div = this.html?.deref() || document.createElement("div");
		const canManageChannels = this.guild.member?.hasPermission("MANAGE_CHANNELS") ?? false;
		div.innerHTML = "";

		this.showMuteState(div);

		this.html = new WeakRef(div);
		if (!this.visible) {
			let quit = true;
			for (const thing of this.children) {
				if (thing.visible) {
					quit = false;
				}
			}
			if (quit) {
				return div;
			}
		}
		div.draggable = canManageChannels && !this.isThread();
		div.addEventListener("dragstart", (e) => {
			Channel.dragged = [this, div];
			e.stopImmediatePropagation();
		});
		div.addEventListener("dragend", () => {
			Channel.dragged = [];
		});
		const childrendiv = document.createElement("div");
		childrendiv.classList.add("channels");
		for (const channel of this.children.filter((_) => !_.isThread() || _.threadVis())) {
			childrendiv.appendChild(channel.createguildHTML());
		}

		if (this.type === 4) {
			this.sortchildren();
			const caps = document.createElement("div");

			const decdiv = document.createElement("div");
			const decoration = document.createElement("span");
			decoration.classList.add("svgicon", "collapse-icon", "svg-category");
			decdiv.appendChild(decoration);

			const myhtml = document.createElement("p2");
			myhtml.classList.add("ellipsis");
			myhtml.textContent = this.name;
			this.nameSpan = new WeakRef(myhtml);
			decdiv.appendChild(myhtml);
			caps.appendChild(decdiv);

			if (this.guild.member.hasPermission("MANAGE_CHANNELS")) {
				const addchannel = document.createElement("span");
				addchannel.classList.add("addchannel", "svgicon", "svg-plus");
				caps.appendChild(addchannel);
				addchannel.onclick = (_) => {
					this.guild.createchannels(this.createChannel.bind(this));
				};
				this.coatDropDiv(decdiv, childrendiv);
			}
			div.appendChild(caps);
			caps.classList.add("flexltr", "capsflex");
			decdiv.classList.add("flexltr", "channeleffects");
			decdiv.classList.add("channel");

			Channel.contextmenu.bindContextmenu(decdiv, this, undefined);

			setTimeout((_: any) => {
				if (!this.perminfo.collapsed) {
					childrendiv.style.height = childrendiv.scrollHeight + "px";
				}
			}, 100);

			if (this.perminfo.collapsed) {
				decoration.classList.add("hiddencat");
				childrendiv.style.height = "0px";
			}
			const handleColapse = async (animate: boolean = true) => {
				if (this.perminfo.collapsed) {
					decoration.classList.add("hiddencat");
					childrendiv.style.height = childrendiv.scrollHeight + "px";
					await new Promise((res) => setTimeout(res, 0));
					childrendiv.style.height = "0px";
				} else {
					decoration.classList.remove("hiddencat");
					if (childrendiv.style.height === "0px" && animate) {
						childrendiv.style.height = childrendiv.scrollHeight + "px";
					} else {
						childrendiv.style.removeProperty("height");
					}
				}
			};
			const observer = new MutationObserver(handleColapse.bind(this, false));
			observer.observe(childrendiv, {childList: true, subtree: true});

			decdiv.onclick = () => {
				this.perminfo.collapsed = !this.perminfo.collapsed;
				handleColapse();
			};
		} else {
			childrendiv.classList.add("threads");
			div.classList.add("channel");
			this.unreads();
			Channel.contextmenu.bindContextmenu(div, this, undefined);
			if (canManageChannels && !this.isThread()) {
				this.coatDropDiv(div);
			}
			const button = document.createElement("button");
			button.classList.add("channelbutton");

			div.append(button);
			const myhtml = document.createElement("span");
			myhtml.classList.add("ellipsis");
			myhtml.textContent = this.name;
			this.nameSpan = new WeakRef(myhtml);
			const decoration = this.renderIcon();
			button.appendChild(decoration);
			button.appendChild(myhtml);
			button.onclick = (_) => {
				this.getHTML();
				const toggle = document.getElementById("maintoggle") as HTMLInputElement;
				toggle.checked = true;
			};
			if (this.type === 2) {
				const voiceUsers = document.createElement("div");
				div.append(voiceUsers);
				this.voiceUsers = new WeakRef(voiceUsers);
				this.updateVoiceUsers();
			}
		}
		div.appendChild(childrendiv);
		return div;
	}
	owner_id?: string;
	threadVis() {
		return (this.member && !this.threadData?.archived) || this.localuser.channelfocus === this;
	}
	async setUpVoice() {
		if (!this.voice) return;
		this.voice.onUserVol = (u) => {
			u.volume = this.localuser.getUserAudio(u.id) / 100;
		};
		this.voice.onMemberChange = async (memb, joined) => {
			if (typeof memb !== "string") {
				await Member.new(memb, this.guild);
			}

			const users = this.usersDiv.deref();
			if (users) {
				const user = await this.localuser.getUser(typeof memb === "string" ? memb : memb.id);
				if (joined) {
					this.makeUserBox(user, users);
				} else {
					this.destUserBox(user);
				}
			}

			this.updateVoiceUsers();
		};
		this.voice.onUserChange = (user, change) => {
			this.boxChange(user, change);
		};
		this.voice.onSpeakingChange = (id, speaking) => {
			const box = this.boxMap.get(id);
			if (box) {
				if (speaking) {
					box.classList.add("speaking");
				} else {
					box.classList.remove("speaking");
				}
			}
			const tray = this.voiceTray.get(id);
			if (tray && tray.parentElement) {
				const parent = tray.parentElement;
				const pfp = parent.children[0].getElementsByClassName("pfp")[0];
				if (!pfp) return;
				if (speaking) {
					pfp.classList.add("speaking");
				} else {
					pfp.classList.remove("speaking");
				}
			}
		};
	}
	voiceTray = new Map<string, HTMLDivElement>();
	async updateVoiceUsers() {
		const voiceUsers = this.voiceUsers.deref();
		if (!voiceUsers || !this.voice) return;

		const html = (
			await Promise.all(
				this.voice.userids
					.entries()
					.toArray()
					.map(async (_) => {
						const user = await User.resolve(_[0], this.localuser);
						const member = await Member.resolveMember(user, this.guild);
						const array = [member, _[1]] as [Member, (typeof _)[1]];
						return array;
					}),
			)
		).flatMap(([member, obj]) => {
			if (!member) {
				console.warn("This is weird, member doesn't exist :P");
				return [];
			}
			const div = document.createElement("div");
			userVolMenu.bindContextmenu(div, this.localuser, member.id);
			div.classList.add("voiceuser", "flexltr");
			const span = document.createElement("span");
			span.textContent = member.name;
			member.subName(span);

			const tray = document.createElement("div");
			tray.classList.add("flexltr", "voiceTray");

			div.append(member.user.buildpfp(member), span, tray);
			member.user.bind(div, member.guild);

			this.voiceTray.set(member.id, tray);
			this.boxChange(member.id, obj);
			return div;
		});

		voiceUsers.innerHTML = "";
		voiceUsers.append(...html);
	}
	get myhtml() {
		if (this.html) {
			return this.html.deref();
		} else {
			return;
		}
	}
	readbottom() {
		if (!this.unreadState()) {
			this.guild.unreads();
			return;
		}
		this.mentions = 0;
		const acked = this.trueLastMessageid;
		fetchRetryOnce(
			this.info.api + "/channels/" + this.id + "/messages/" + acked + "/ack",
			{method: "POST", headers: this.headers, body: JSON.stringify({})},
			// The server's read state goes where it's told: a retry after a newer ack moves it back.
			{shouldRetry: () => this.lastreadmessageid === acked},
		).catch(() => {}); // bookkeeping: nothing reacts to a failed ack
		const next = this.messages.get(this.idToNext.get(this.lastreadmessageid as string) as string);
		this.lastreadmessageid = this.trueLastMessageid;
		this.guild.unreads();
		this.unreads();
		if (next) {
			next.generateMessage();
		}
		this.infinite.toBottom();
	}
	static lastDragDiv = document.createElement("div");
	coatDropDiv(div: HTMLDivElement, container: HTMLElement | false = false) {
		div.style.position = "relative";
		div.addEventListener("dragenter", (event) => {
			event.preventDefault();
		});
		const dragDiv = () => {
			if (Channel.lastDragDiv !== div) {
				Channel.lastDragDiv.classList.remove("dragTopView");
				Channel.lastDragDiv.classList.remove("dragBottomView");
			}
			Channel.lastDragDiv = div;
		};

		div.addEventListener("dragover", (event) => {
			dragDiv();
			const height = div.getBoundingClientRect().height;

			if (event.offsetY / height < 0.5) {
				div.classList.add("dragTopView");
				div.classList.remove("dragBottomView");
			} else {
				div.classList.remove("dragTopView");
				div.classList.add("dragBottomView");
			}
			event.preventDefault();
		});
		div.addEventListener("dragleave", () => {
			dragDiv();
			div.classList.remove("dragTopView");
			div.classList.remove("dragBottomView");
		});
		div.addEventListener("drop", (event) => {
			dragDiv();
			div.classList.remove("dragTopView");
			div.classList.remove("dragBottomView");
			const that = Channel.dragged[0];
			if (!that) return;
			event.preventDefault();
			const height = div.getBoundingClientRect().height;
			const before = event.offsetY / height < 0.5;
			// thisy (the row the drop is relative to) and the anchors for placing the dragged
			// row are read before any mutation: bailing out afterwards would leave the model
			// moved with nothing sent or restored. The snapshot comes after the bail: a drop
			// that changes nothing must not cancel an in-flight drag's restore.
			let thisy = this as Channel;
			if (that.type === 4 && this.parent) {
				thisy = this.parent;
			}
			const useContainer = Boolean(container) && that.type !== 4 && !before;
			const needAnchors =
				!useContainer && Channel.dragged[1] !== undefined && !(this === thisy && this.type !== 4);
			const tdiv = needAnchors
				? ((div.parentElement as HTMLDivElement | null)?.parentElement as HTMLElement | null)
				: undefined;
			if (needAnchors && !tdiv) return;
			const restore = this.guild.snapshotLayout();
			if (useContainer) {
				// Places at the top of the category; moveInto places at the end.
				that.move_id = this.id;
				if (that.parent) {
					that.parent.children.splice(that.parent.children.indexOf(that), 1);
				} else {
					const i = this.guild.headchannels.indexOf(that);
					if (i !== -1) this.guild.headchannels.splice(i, 1);
				}
				that.parent = this;
				that.parent_id = this.id;
				(container as HTMLElement).prepend(Channel.dragged[1] as HTMLDivElement);
				this.children.unshift(that);
			} else {
				that.move_id = thisy.parent_id;
				if (that.parent) {
					that.parent.children.splice(that.parent.children.indexOf(that), 1);
				} else {
					const i = thisy.guild.headchannels.indexOf(that);
					if (i !== -1) thisy.guild.headchannels.splice(i, 1);
				}
				that.parent = thisy.parent;
				that.parent_id = thisy.parent?.id ?? null;
				if (that.parent) {
					const build: Channel[] = [];
					for (let i = 0; i < that.parent.children.length; i++) {
						build.push(that.parent.children[i]);
						if (that.parent.children[i] === thisy) {
							if (before) build.pop();
							build.push(that);
							if (before) build.push(thisy);
						}
					}
					that.parent.children = build;
				} else {
					const build: Channel[] = [];
					for (let i = 0; i < thisy.guild.headchannels.length; i++) {
						build.push(thisy.guild.headchannels[i]);
						if (thisy.guild.headchannels[i] === thisy) {
							if (before) build.pop();
							build.push(that);
							if (before) build.push(thisy);
						}
					}
					thisy.guild.headchannels = build;
				}
				if (Channel.dragged[1]) {
					if (this === thisy && this.type !== 4) {
						if (before) {
							div.before(Channel.dragged[1]);
						} else {
							div.after(Channel.dragged[1]);
						}
					} else {
						Channel.dragged[1].remove();
						if (before) {
							(tdiv as HTMLElement).before(Channel.dragged[1]);
						} else {
							(tdiv as HTMLElement).after(Channel.dragged[1]);
						}
					}
				}
			}
			void this.guild.calculateReorder(that.id, restore);
		});

		return div;
	}
	async createChannel(name: string, type: number): Promise<boolean> {
		const res = await fetch(this.info.api + "/guilds/" + this.guild.id + "/channels", {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify({
				name,
				type,
				parent_id: this.id,
				permission_overwrites: [],
			}),
		}).catch(() => undefined);
		if (!res?.ok) {
			await showRefusal(res);
			return false;
		}
		const body = await res
			.clone()
			.json()
			.catch(() => null);
		if (typeof body?.id !== "string") {
			await showRefusal(res);
			return false;
		}
		this.guild.goToChannelDelay(body.id);
		return true;
	}
	async deleteChannel(): Promise<boolean> {
		const res = await fetch(this.info.api + "/channels/" + this.id, {
			method: "DELETE",
			headers: this.headers,
		}).catch(() => undefined);
		if (!res?.ok) {
			await showRefusal(res);
			return false;
		}
		return true;
	}
	setReplying(message: Message) {
		if (this.replyingto?.div) {
			this.replyingto.div.classList.remove("replying");
		}
		this.replyingto = message;
		const typebox = document.getElementById("typebox") as HTMLElement;
		typebox.focus();
		if (!this.replyingto?.div) return;
		this.replyingto.div.classList.add("replying");
		this.makereplybox();
	}
	makereplybox() {
		const replybox = document.getElementById("replybox") as HTMLElement;
		const typebox = document.getElementById("typebox") as HTMLElement;
		if (this.replyingto) {
			replybox.innerHTML = "";
			const span = document.createElement("span");
			span.textContent = I18n.replyingTo(this.replyingto.author.username);
			const X = document.createElement("button");
			X.onclick = (_) => {
				if (this.replyingto?.div) {
					this.replyingto.div.classList.remove("replying");
				}
				replybox.classList.add("hideReplyBox");
				this.replyingto = null;
				replybox.innerHTML = "";
				typebox.classList.remove("typeboxreplying");
				typebox.blur();
			};
			replybox.classList.remove("hideReplyBox");
			X.classList.add("cancelReply", "svgicon", "svg-x");
			replybox.append(span);
			replybox.append(X);
			typebox.classList.add("typeboxreplying");
		} else {
			replybox.classList.add("hideReplyBox");
			replybox.innerHTML = "";
			typebox.classList.remove("typeboxreplying");
		}
	}
	async getmessage(id: string): Promise<Message | undefined> {
		const message = this.messages.get(id);
		if (message) {
			return message;
		} else {
			const gety = await fetch(
				this.info.api + "/channels/" + this.id + "/messages?limit=1&around=" + id,
				{headers: this.headers},
			).catch(() => undefined);
			// A refusal (403, 404, 429) answers with an error object, not a list; a failed fetch
			// or a body that isn't JSON is no message either.
			const json: unknown = gety?.ok ? await gety.json().catch(() => undefined) : undefined;
			if (!Array.isArray(json) || json.length === 0) {
				return undefined;
			}
			return new Message(json[0], this);
		}
	}
	async getMessages(id: string) {
		const m = await this.getmessage(id);
		if (!m) return;
		const waits: Promise<unknown>[] = [];
		let m1: string | undefined = m.id;
		for (let i = 0; i <= 50; i++) {
			if (!m1) {
				waits.push(this.grabBefore(id));
				break;
			}
			if ((this.idToNext.has(m1) && !this.idToNext.get(m1)) || this.lastmessage?.id === m1) break;
			m1 = this.idToNext.get(m1);
		}
		m1 = m.id;
		for (let i = 0; i <= 50; i++) {
			if (!m1) {
				waits.push(this.grabAfter(id));
				break;
			}
			if (this.idToPrev.has(m1) && !this.idToPrev.get(m1)) break;
			m1 = this.idToPrev.get(m1);
		}
		await Promise.all(waits);
	}
	async focus(id: string, flash = true) {
		const prom = this.getMessages(id);

		if (await Promise.race([prom, new Promise((res) => setTimeout(() => res(true), 300))])) {
			const loading = document.getElementById("loadingdiv") as HTMLDivElement;
			Channel.regenLoadingMessages();
			loading.classList.add("loading");
			try {
				await prom;
			} finally {
				loading.classList.remove("loading");
			}
		}

		if (this.localuser.channelfocus !== this) {
			await this.getHTML(true);
		}

		try {
			await this.infinite.focus(id, flash, true);
		} catch {}
	}
	editLast() {
		let message: Message | undefined = this.lastmessage;
		while (message && !message.canEdit()) {
			message = this.messages.get(this.idToPrev.get(message.id) as string);
		}
		if (message) {
			message.setEdit();
		}
	}
	static genid: number = 0;
	nsfwPannel() {
		(document.getElementById("typebox") as HTMLDivElement).contentEditable = "" + false;
		(document.getElementById("upload") as HTMLElement).style.visibility = "hidden";
		(document.getElementById("typediv") as HTMLElement).style.visibility = "hidden";
		const messages = document.getElementById("scrollWrap") as HTMLDivElement;
		const messageContainers = Array.from(messages.getElementsByClassName("messagecontainer"));
		for (const thing of messageContainers) {
			thing.remove();
		}
		Channel.clearScrollWrapLeaks();
		const div = document.getElementById("sideDiv") as HTMLDivElement;
		div.innerHTML = "";
		const float = new Float("");
		const options = float.options;
		// nsfw_allowed is tri-state on Discord's wire (null = unattested); this fork's NOT NULL
		// column only ever sends true/false. false is an attested-minor account: the server derives
		// the flag from the birthdate on its DOB route, and this panel doesn't duplicate that flow —
		// attestation belongs to the account-level DOB flow, so the panel offers a way back instead.
		// Unknown values (null/undefined, a stock-Spacebar or event-merged absence) stay gated for
		// good per the shipped nsfwGated matrix, so they get the same back-only panel rather than a
		// Yes that could never pass the gate.
		//@ts-expect-error weird hack, ik, but the user here does have that information
		//TODO make an extention of the user class with these aditional properties
		if (this.localuser.user.nsfw_allowed !== true) {
			options.addTitle(I18n.channel.notAllowed());
			const buttons = options.addOptions("", {ltr: true});
			buttons.addButtonInput("", I18n.forum.back(), () => {
				window.history.back();
			});
		} else if (getSensitiveContentSync().nsfw === "block") {
			options.addTitle(I18n.channel.nsfwBlocked());
			const buttons = options.addOptions("", {ltr: true});
			buttons.addButtonInput("", I18n.forum.back(), () => {
				window.history.back();
			});
		} else {
			options.addTitle(I18n.channel.nsfwAsk());
			const buttons = options.addOptions("", {ltr: true});
			buttons.addButtonInput("", I18n.yes(), () => {
				this.perminfo.nsfwOk = true;
				this.localuser.channelfocus = undefined;
				this.getHTML(true, true);
			});
			buttons.addButtonInput("", I18n.no(), () => {
				window.history.back();
			});
		}
		const html = float.generateHTML();
		html.classList.add("messagecontainer");
		messages.append(html);
	}
	unreadPins() {
		if (!this.last_pin_timestamp && !this.lastpin) return false;
		return this.last_pin_timestamp !== this.lastpin;
	}
	boxMap = new Map<string, HTMLElement>();
	liveMap = new Map<string, HTMLElement>();
	destUserBox(user: User) {
		const box = this.boxMap.get(user.id);
		if (!box) return;
		box.remove();
		this.boxMap.delete(user.id);
		const live = this.liveMap.get(user.id);
		if (live) {
			live.remove();
			this.liveMap.delete(user.id);
		}
	}
	boxVid(id: string, elm: HTMLVideoElement) {
		const box = this.boxMap.get(id);
		if (!box) return;
		box.append(elm);
		if (!elm.paused && elm.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
			box.getElementsByClassName("vidloading")[0]?.remove();
			return;
		}
		// The overlay is per box, the listener per element: renegotiation can deliver a
		// replacement while the first element is still loading, so every arrival (re)arms
		// on itself. Repeat listeners are `once` and their extra removes are no-ops.
		// Accepted edge: a REPLACED element's late playing can dismiss the new overlay a
		// few seconds early (both elements stay connected here, so isConnected can't tell
		// them apart) — cosmetic, and strictly better than the old permanent spinner.
		let loading = box.getElementsByClassName("vidloading")[0];
		if (!loading) {
			loading = document.createElement("div");
			loading.classList.add("vidloading");
			loading.setAttribute("role", "status");
			// Dots first: .dot:nth-child(2/3) stagger the pulse by child INDEX, so the
			// visually-hidden label must not precede them.
			for (let i = 0; i < 3; i++) {
				const dot = document.createElement("span");
				dot.classList.add("dot");
				loading.append(dot);
			}
			const label = document.createElement("span");
			label.classList.add("visually-hidden");
			label.textContent = I18n.vc.videoLoading();
			loading.append(label);
			box.append(loading);
		}
		elm.addEventListener("playing", () => loading.remove(), {once: true});
	}
	makeBig(box: HTMLElement) {
		const par = box.parentElement;
		if (!par) return;
		if (par.children[0] !== box || !box.classList.contains("bigBox")) {
			box.classList.add("bigBox");
			if (par.children[0] !== box) {
				par.children[0].classList.remove("bigBox");
			}
		} else {
			par.children[0].classList.remove("bigBox");
		}
		par.prepend(box);
	}
	decorateLive(id: string) {
		if (!this.voice) return;
		const box = this.liveMap.get(id);
		if (!box) return;
		box.innerHTML = "";
		const live = this.voice.getLive(id);
		const self = id === this.localuser.user.id;
		if (!this.voice.open) {
			const span = document.createElement("span");
			span.textContent = I18n.vc.joinForStream();
			box.append(span);
		} else if (live) {
			const leave = document.createElement("button");
			leave.classList.add("leave");
			leave.textContent = self ? I18n.vc.stopstream() : I18n.vc.leavestream();
			leave.onclick = (e) => {
				e.stopImmediatePropagation();
				if (self) {
					this.voice?.stopStream();
				} else {
					this.voice?.leaveLive(id);
				}
			};
			box.append(live, leave);
		} else if (!self) {
			const joinB = document.createElement("button");
			joinB.textContent = I18n.vc.joinstream();
			joinB.classList.add("joinb");
			box.append(joinB);
			joinB.onclick = () => {
				if (!this.voice) return;
				box.innerHTML = "";
				const span = document.createElement("span");
				span.textContent = I18n.vc.joiningStream();
				box.append(span);
				this.voice.joinLive(id);
			};
		}
	}
	purgeVid(id: string) {
		const box = this.boxMap.get(id);
		if (!box) return;
		box.getElementsByClassName("vidloading")[0]?.remove();
		const videos = Array.from(box.getElementsByTagName("video"));
		videos.forEach((_) => _.remove());
	}
	boxChange(id: string, change: {deaf: boolean; muted: boolean; video: boolean; live: boolean}) {
		const box = this.boxMap.get(id);

		if (!this.voice) return;
		if (box) {
			console.warn("purge:" + id);
			const vid = this.voice.videos.get(id);
			if (vid && change.video) {
				this.boxVid(id, vid);
			} else if (!change.video) {
				this.purgeVid(id);
			}
			Array.from(box.getElementsByClassName("statBub")).forEach((_) => _.remove());
			const statBub = document.createElement("div");
			statBub.classList.add("statBub");
			if (change.muted) {
				const span = document.createElement("span");
				span.classList.add("svg-micmute");
				statBub.append(span);
				box.append(statBub);
			} else if (change.video) {
				const span = document.createElement("span");
				span.classList.add("svg-video");
				statBub.append(span);
				box.append(statBub);
			}
		}

		const live = this.liveMap.get(id);
		if (live && !change.live) {
			live.remove();
			this.liveMap.delete(id);
		} else if (!live && change.live && box) {
			const livediv = document.createElement("div");
			this.liveMap.set(id, livediv);
			livediv.onclick = () => {
				this.makeBig(livediv);
			};
			box.parentElement?.prepend(livediv);
			this.decorateLive(id);
		}

		const tray = this.voiceTray.get(id);
		if (tray) {
			console.warn("tray build", tray, change);
			tray.innerHTML = "";
			if (change.muted) {
				const span = document.createElement("span");
				span.classList.add("svg-micmute");
				tray.append(span);
			}
			if (change.video) {
				const span = document.createElement("span");
				span.classList.add("svg-video");
				tray.append(span);
			}
		}
	}
	async makeUserBox(user: User, users: HTMLElement) {
		const memb = Member.resolveMember(user, this.guild);
		const box = document.createElement("div");
		userVolMenu.bindContextmenu(box, this.localuser, user.id);
		box.onclick = () => {
			this.makeBig(box);
		};
		this.boxMap.set(user.id, box);
		if (user.accent_color != undefined) {
			box.style.setProperty(
				"--accent_color",
				`#${user.accent_color.toString(16).padStart(6, "0")}`,
			);
		}
		memb.then((_) => {
			if (!_) return;
			if (_.accent_color !== undefined) {
				box.style.setProperty("--accent_color", `#${_.accent_color.toString(16).padStart(6, "0")}`);
			}
		});

		box.append(user.buildpfp(this.guild));

		const span = document.createElement("span");
		span.textContent = user.name;
		memb.then((_) => {
			if (!_) {
				user.subName(span);
				return;
			}
			_.subName(span);
			span.textContent = _.name;
		});
		span.classList.add("voiceUsername");
		box.append(span);
		users.append(box);
		if (!this.voice) return;
		const change = this.voice.userids.get(user.id);
		if (!change) return;
		this.boxChange(user.id, change);
	}
	usersDiv = new WeakRef(document.createElement("div"));
	async setUpVoiceArea() {
		if (!this.voice) throw new Error("voice not found?");
		const voiceArea = document.getElementById("voiceArea") as HTMLElement;
		const buttonRow = document.createElement("div");
		buttonRow.classList.add("flexltr", "buttonRow");
		const updateMicIcon = () => {
			mspan.classList.remove("svg-micmute", "svg-mic");
			mspan.classList.add(this.localuser.mute ? "svg-micmute" : "svg-mic");
		};

		const mute = document.createElement("div");
		const mspan = document.createElement("span");
		mute.append(mspan);
		updateMicIcon();
		this.localuser.updateOtherMic = updateMicIcon;
		mute.onclick = () => {
			this.localuser.mute = !this.localuser.mute;
			this.localuser.updateMic();
		};
		mute.classList.add("muteVoiceIcon");

		const muteOpt = document.createElement("div");
		muteOpt.classList.add("muteOptDiv");
		const mOptSpan = document.createElement("span");
		mOptSpan.classList.add("svg-category");
		muteOpt.append(mOptSpan);
		mute.append(muteOpt);
		muteOpt.onclick = async (e) => {
			e.preventDefault();
			e.stopImmediatePropagation();
			const menu = new Contextmenu<void, void>("");
			const mics = await this.localuser.getAudioDeviceList();
			for (const mic of mics) {
				menu.addButton(
					mic.label,
					() => {
						this.localuser.setNewDefualtDevice(mic.deviceId);
					},
					{
						icon: {
							css:
								mic.deviceId === this.localuser.getDefaultAudio() ? "svg-select" : "svg-noSelect",
						},
					},
				);
			}
			const box = muteOpt.getBoundingClientRect();
			menu.makemenu(box.left, box.top - 34 - getViewportHeight());
		};

		const updateCallIcon = () => {
			cspan.classList.remove("svg-call", "svg-hangup");
			cspan.classList.add(this.voice?.open ? "svg-hangup" : "svg-call");
		};
		const call = document.createElement("div");
		const cspan = document.createElement("span");
		call.append(cspan);
		updateCallIcon();
		call.onclick = async () => {
			if (this.voice?.userids.has(this.localuser.user.id)) {
				this.voice.leave();
			} else if (this.voice) {
				await this.localuser.joinVoice(this);
			}
			updateCallIcon();
		};
		call.classList.add("callVoiceIcon");

		const updateVideoIcon = () => {
			vspan.classList.remove("svg-video", "svg-novideo");
			vspan.classList.add(this.localuser.voiceFactory?.video ? "svg-video" : "svg-novideo");
		};
		const video = document.createElement("div");
		const vspan = document.createElement("span");
		video.append(vspan);
		updateVideoIcon();
		video.onclick = async () => {
			if (!this.voice) return;
			if (!this.voice.open) return;
			if (this.localuser.voiceFactory?.video) {
				this.voice.stopVideo();
			} else {
				const cam = await navigator.mediaDevices.getUserMedia({
					video: {
						advanced: [
							{
								aspectRatio: 1.75,
							},
						],
					},
				});
				if (!cam) return;
				this.voice.startVideo(cam);
			}
			updateVideoIcon();
		};
		video.classList.add("callVoiceIcon");

		const updateLiveIcon = () => {
			lspan.classList.remove("svg-stream", "svg-stopstream");
			lspan.classList.add(this.voice?.isLive() ? "svg-stopstream" : "svg-stream");
		};
		const live = document.createElement("div");
		const lspan = document.createElement("span");
		live.append(lspan);
		updateLiveIcon();
		live.onclick = async () => {
			if (!this.voice?.open) return;
			if (this.voice?.isLive()) {
				this.voice?.stopStream();
			} else {
				const stream = await navigator.mediaDevices.getDisplayMedia();
				await this.voice?.createLive(stream);
			}
			updateLiveIcon();
		};
		live.classList.add("callVoiceIcon");

		const chat = document.createElement("div");
		const chatspan = document.createElement("span");
		chatspan.classList.add("svg-frmessage");
		chat.append(chatspan);
		updateLiveIcon();
		chat.onclick = async () => {
			this.voiceMode = this.voiceMode === "VoiceOnly" ? "ChatAndVoice" : "VoiceOnly";
			this.getHTML(true);
		};
		chat.classList.add("callVoiceIcon");

		buttonRow.append(mute, video, live, call, chat);

		const users = document.createElement("div");
		const mut = new MutationObserver(() => {
			const arr = Array.from(users.children);
			const box = arr.find((_) => _.classList.contains("bigBox"));
			if (box && arr[0] !== box) {
				users.prepend(box);
			}
		});
		mut.observe(users, {
			childList: true,
		});
		users.classList.add("voiceUsers");

		this.voice.userids.forEach(async (_, id) => {
			const user = await this.localuser.getUser(id);
			this.makeUserBox(user, users);
		});
		[...this.liveMap].forEach(([_, box]) => {
			users.prepend(box);
		});
		this.usersDiv = new WeakRef(users);

		voiceArea.append(users, buttonRow);
		this.voice.onVideo = (vid, id) => {
			this.localuser.regenVoiceIcons();
			this.boxVid(id, vid);
			updateVideoIcon();
		};
		this.voice.onGotStream = (_vid, id) => {
			this.localuser.regenVoiceIcons();
			updateLiveIcon();
			this.decorateLive(id);
		};
		this.voice.onconnect = () => {
			if (!this.voice) return;
			for (const [_, user] of this.voice.users) {
				this.decorateLive(user);
			}
		};
		this.voice.onLeaveStream = (id) => {
			this.decorateLive(id);
			updateLiveIcon();
			this.localuser.regenVoiceIcons();
		};

		this.voice.onLeave = () => {
			updateCallIcon();
			updateVideoIcon();
			for (const [id] of this.boxMap) {
				this.purgeVid(id);
			}
			if (!this.voice) return;
			for (const [_, user] of this.voice.users) {
				this.decorateLive(user);
			}
		};
	}
	files: Blob[] = [];
	htmls = new WeakMap<Blob, HTMLElement>();
	textSave = "";
	private static readonly DRAFT_STORAGE_KEY = "channelDraftsV1";
	private get draftStorageId() {
		return `${this.localuser.userinfo.uid}:${this.id}`;
	}
	private getStoredDraft() {
		try {
			const raw = localStorage.getItem(Channel.DRAFT_STORAGE_KEY);
			if (!raw) return "";
			const parsed = JSON.parse(raw) as {[key: string]: string};
			return parsed[this.draftStorageId] || "";
		} catch {
			return "";
		}
	}
	private setStoredDraft(content: string) {
		try {
			const raw = localStorage.getItem(Channel.DRAFT_STORAGE_KEY);
			const parsed = (raw ? JSON.parse(raw) : {}) as {[key: string]: string};
			if (content) {
				parsed[this.draftStorageId] = content;
			} else {
				delete parsed[this.draftStorageId];
			}
			localStorage.setItem(Channel.DRAFT_STORAGE_KEY, JSON.stringify(parsed));
		} catch {}
	}
	setDraft(content: string) {
		this.textSave = content;
		this.setStoredDraft(content);
	}
	collectBox() {
		const typebox = document.getElementById("typebox") as CustomHTMLDivElement;
		const [files, html] = this.localuser.fileExtange([], new WeakMap<Blob, HTMLElement>());
		this.files = files;
		this.htmls = html;
		this.setDraft(MarkDown.gatherBoxText(typebox));
		typebox.textContent = "";
	}
	curCommand?: Command;
	curWatch = () => {};
	/** Tears command mode down: chips and the command front go, the composer types again, and
	 * the command's per-channel state is dropped so a later start begins clean. */
	exitCommand() {
		this.curCommand?.state.delete(this);
		this.curCommand = undefined;
		const typebox = document.getElementById("typebox") as CustomHTMLDivElement;
		typebox.removeEventListener("keyup", this.curWatch);
		typebox.markdown.boxEnabled = true;
		typebox.innerHTML = "";
		typebox.markdown.boxupdate();
		// The branch picker's popup is offered on insert, so the default bail gesture is
		// Backspace with it open: clear it or its ghost rows eat the next Enter.
		document.getElementById("searchOptions")?.replaceChildren();
		typebox.focus();
	}
	/** The command whose POST is in flight: a second Enter or send tap must not run it twice. */
	private submittingCommand?: Command;
	async submitCommand() {
		const cmd = this.curCommand;
		if (!cmd || this.submittingCommand === cmd) return;
		this.submittingCommand = cmd;
		try {
			const typebox = document.getElementById("typebox") as CustomHTMLDivElement;
			if (await cmd.submit(typebox, this)) {
				// Only tear down what's still there: the user may have bailed (or started
				// something else) while the POST was in flight.
				if (this.curCommand === cmd) this.exitCommand();
			}
		} finally {
			if (this.submittingCommand === cmd) this.submittingCommand = undefined;
		}
	}
	startCommand(command: Command, branch?: string) {
		this.curCommand = command;
		const typebox = document.getElementById("typebox") as CustomHTMLDivElement;
		typebox.markdown.boxEnabled = false;
		const func = (e?: KeyboardEvent) => {
			// Escape closes the option popup (handleEnter clears it first); refreshing the
			// offer on this same keyup would reopen it out from under the close.
			if (e?.key === "Escape") return;
			const node = window.getSelection()?.focusNode;
			if (this.localuser.channelfocus === this) {
				const out = command.collect(typebox, this, node || undefined);
				if (!out) {
					typebox.markdown.boxEnabled = true;
					typebox.markdown.boxupdate();
					typebox.removeEventListener("keyup", func);
				}
			}
		};
		this.curWatch = func;
		typebox.addEventListener("keyup", func);
		command.render(typebox, this);
		// The picker's subcommand rows ("/name sub") start the command with the branch
		// already chosen.
		if (branch) command.prePick(this, branch);
	}
	isForum() {
		return this.type === 15 || this.type === 16;
	}
	async renderThread(update = true) {
		let div = document.createElement("div");
		if (update) {
			const up = async () => {
				if (!document.contains(div)) {
					this.updateEvents.delete(up);
					return;
				}
				const c = await this.renderThread(false);
				if (!c) return;
				div.after(c);
				div.remove();
				div = c;
			};
			this.updateEvents.add(up);
		}
		div.classList.add("flexttb", "forumPostBody");
		div.onclick = (e) => {
			if (e.button === 0) this.getHTML();
		};
		Channel.contextmenu.bindContextmenu(div, this, undefined);
		const tags = document.createElement("div");
		tags.classList.add("flexltr", "tagDiv");
		for (const tagid of this.appliedTags) {
			const tag = this.parent?.availableTags.find((tag) => tag.id === tagid);
			if (!tag) continue;
			tags.append(tag.makeHTML());
		}
		div.append(tags);

		const title = document.createElement("h3");
		title.textContent = new MarkDown(this.name).makeHTML().textContent;
		div.append(title);

		const member =
			(await this.localuser.getMember(this.owner_id as string, this.guild.id)) ||
			(await User.resolve(this.owner_id as string, this.localuser));
		const message = this.localuser.messages.get(this.id);

		const name = document.createElement("span");
		name.classList.add("forumUsername");
		name.textContent = (member?.name || I18n.user.deleted()) + ": ";

		const messageContent = document.createElement("span");
		messageContent.classList.add("messageForumContent");
		if (message) {
			const raw = message.content.rawString;
			const preview =
				raw.length <= FORUM_MESSAGE_PREVIEW_MAX_LENGTH
					? raw
					: raw.slice(0, FORUM_MESSAGE_PREVIEW_MAX_LENGTH - 3) + "...";
			messageContent.append(new MarkDown(preview, message.channel).makeHTML());
		} else {
			messageContent.textContent = I18n.message.deleted();
		}

		const mrow = document.createElement("div");
		mrow.classList.add("flexltr");
		mrow.append(name, messageContent);
		div.append(mrow);

		const micon = document.createElement("span");
		micon.classList.add("svg-frmessage", "svgicon");

		const mcount = document.createElement("span");
		mcount.textContent = this.messageCount + "";

		const msep = document.createElement("span");
		msep.classList.add("msep");

		const mtime = document.createElement("span");
		const updateTime = () => {
			mtime.textContent = MarkDown.relTime(
				new Date(
					this.lastmessageid ? SnowFlake.stringToUnixTime(this.lastmessageid) : this.getUnixTime(),
				),
				() => {
					if (!document.contains(mtime)) return;
					updateTime();
				},
			);
		};
		updateTime();

		const lrow = document.createElement("div");
		lrow.classList.add("forumMessageRow", "flexltr");

		lrow.append(micon, mcount, msep, mtime);
		div.append(lrow);

		return div;
	}
	appliedTags = [] as string[];
	forumFilters = {
		sortActive: true,
		recentFirst: true,
		tagMatchAll: false,
		tags: [] as string[],
	};
	hasFetchedForForum = false;
	/** The post-data fetch on its way, shared by searches started meanwhile (opening, typing). */
	private forumFetch?: Promise<void>;
	/** Gives this category's channels (not threads) its permission overwrites, then says it did,
	 * or why a channel didn't take them. */
	async syncPermsToChildren() {
		const overwrites: {id: string; type: number; allow: string; deny: string}[] = [];
		for (const [id, perms] of this.permission_overwrites) {
			overwrites.push({
				id,
				type: this.guild.roleids.has(id) ? 0 : 1,
				allow: perms.allow.toString(),
				deny: perms.deny.toString(),
			});
		}
		const promises: Promise<Response | undefined>[] = [];
		for (const child of this.children) {
			if (child.isThread()) continue;
			promises.push(
				fetch(this.info.api + "/channels/" + child.id, {
					method: "PATCH",
					headers: this.headers,
					body: JSON.stringify({permission_overwrites: overwrites}),
				}).catch(() => undefined),
			);
		}
		const answers = await Promise.all(promises);
		const failed = answers.findIndex((res) => !res?.ok);
		if (failed !== -1) return showRefusal(answers[failed]);
		new Dialog(I18n.channel.syncPermsSuccess()).show();
	}
	editTags() {
		const d = new Dialog(I18n.threads.editTags());
		if (!this.appliedTags || !this.parent) return;
		let tagList = [...this.appliedTags];
		let patchSeq = 0;
		// What the server holds: a refusal goes back to it, not to an earlier unanswered click.
		let accepted = tagList;
		const patchList = async (sent: string[]) => {
			const seq = ++patchSeq;
			const res = await fetch(this.info.api + "/channels/" + this.id, {
				method: "PATCH",
				headers: this.headers,
				body: JSON.stringify({
					applied_tags: sent,
				}),
			}).catch(() => undefined);
			if (res?.ok) {
				accepted = sent;
			} else if (seq === patchSeq) {
				tagList = accepted;
				for (const [id, elm] of tagElms) {
					elm.classList.toggle("selected", tagList.includes(id));
				}
				await showRefusal(res);
			}
		};

		const tags = document.createElement("div");
		tags.classList.add("forumTagSelect");
		const tagElms = new Map<string, HTMLDivElement>();
		for (const tag of this.parent.availableTags.filter(
			(tag) => !tag.moderated || this.hasPermission("MANAGE_THREADS"),
		)) {
			const html = tag.makeHTML();
			tagElms.set(tag.id, html);
			html.onclick = () => {
				if (tagList.includes(tag.id)) {
					tagList = tagList.filter((id) => id !== tag.id);
					html.classList.remove("selected");
				} else {
					tagList = [...tagList, tag.id].sort();
					html.classList.add("selected");
				}
				void patchList(tagList);
			};
			if (tagList.includes(tag.id)) html.classList.add("selected");
			tags.append(html);
		}
		const opt = d.options;
		opt.addHTMLArea(tags);
		d.show();
	}
	/** The most threads one post-data request may name (the server caps its schema to match). */
	static readonly postDataBatch = 100;
	async fetchForum() {
		const ids = this.children.map(({id}) => id);
		// One batch at a time: a big forum otherwise fires all its batches at once.
		for (let start = 0; start < ids.length; start += Channel.postDataBatch) {
			const res = await fetch(this.info.api + "/channels/" + this.id + "/post-data", {
				method: "POST",
				headers: this.headers,
				body: JSON.stringify({thread_ids: ids.slice(start, start + Channel.postDataBatch)}),
			});
			if (!res.ok) throw new Error(`Forum post data failed: HTTP ${res.status}`, {cause: res});
			const arr = (await res.json().catch(() => null)) as {
				threads?: Record<string, {first_message: null | messagejson; owner: null | memberjson}>;
			} | null;
			// An answer that isn't post data was still an answer: not "offline".
			if (!arr?.threads) {
				throw new Error(`Forum post data unreadable: HTTP ${res.status}`, {cause: res});
			}
			for (const [id, {first_message, owner}] of Object.entries(arr.threads)) {
				const child = this.children.find(({id: cid}) => cid === id);
				if (!child) continue;
				if (owner) Member.new(owner, this.guild);
				if (first_message) {
					const m = this.localuser.messages.get(first_message.id);
					if (!m) this.localuser.messages.set(first_message.id, new Message(first_message, child));
				}
			}
		}
		this.hasFetchedForForum = true;
	}

	umap = new Map<string, [number, string]>();
	search: [string, number, string][] = [];
	hasAllThreads = false;

	async fetchThreads(text: string, offset: number) {
		const filters = this.forumFilters;
		const uid = `${filters.recentFirst}-${filters.sortActive}-${filters.tagMatchAll}-${filters.tags.join("-")}-${text}`;
		const search = new URLSearchParams([
			["archived", "true"],
			["limit", "25"],
			["sort_by", filters.sortActive ? "last_message_time" : "creation_time"],
			["sort_order", filters.recentFirst ? "desc" : "asc"],
			["tag_setting", filters.tagMatchAll ? "match_all" : "match_some"],
			["offset", offset + ""],
			["tag", filters.tags.join(",")],
		]);
		let response: Response;
		try {
			response = await fetch(
				this.info.api + "/channels/" + this.id + "/threads/search?" + search,
				{headers: this.headers},
			);
		} catch (e) {
			// No answer at all (offline, dead socket): nothing learned either, so the
			// posts already loaded are the list for now - like any refusal below.
			console.error("Forum post search failed:", e);
			return;
		}
		// Refused (429, 403…): nothing learned, so the posts already loaded are the list for now.
		if (!response.ok) {
			console.error(`Forum post search failed: HTTP ${response.status}`);
			return;
		}
		let res: {
			threads: channeljson[];
			members: memberjson[];
			messages: messagejson[];
			total_results: number;
			has_more: boolean;
		};
		try {
			res = await response.json();
		} catch {
			// A 2xx body that isn't JSON at all (a proxy's error page): nothing learned.
			console.error("Forum post search: the answer is not JSON");
			return;
		}
		if (!res || !Array.isArray(res.threads) || !Array.isArray(res.messages) || !Array.isArray(res.members)) {
			// A well-formed body of the wrong shape: nothing learned, not a crash.
			console.error("Forum post search: the answer has an unexpected shape");
			return;
		}
		for (const threadjson of res.threads) {
			if (this.localuser.channelids.has(threadjson.id)) continue;
			const thread = new Channel(threadjson, this.guild);
			this.localuser.channelids.set(threadjson.id, thread);
			thread.resolveparent();
		}
		for (const message of res.messages) {
			const thread = this.localuser.channelids.get(message.channel_id);
			if (!thread) continue;
			const m = this.localuser.messages.get(message.id);
			if (!m) this.localuser.messages.set(message.id, new Message(message, thread));
		}
		for (const member of res.members) {
			Member.new(member, this.guild);
		}
		if (res.has_more) {
			const lastid = res.threads.at(-1)?.id as string;
			if (text) {
				const arr = this.search.find(([id]) => id === uid);
				if (arr) {
					arr[1] = offset + 25;
					arr[2] = lastid;
				} else {
					this.search.push([uid, offset + 25, lastid]);
					if (this.search.length > 200) {
						this.search.shift();
					}
				}
			} else {
				this.umap.set(uid, [offset + 25, lastid]);
			}
		} else {
			if (text) {
				const arr = this.search.find(([id]) => id === uid);
				if (arr) {
					arr[1] = offset + 25;
					arr[2] = "-1";
				} else {
					this.search.push([uid, offset + 25, "-1"]);
					if (this.search.length > 200) {
						this.search.shift();
					}
				}
			} else {
				this.umap.clear();
				this.search = [];
				this.hasAllThreads = true;
			}
		}
	}

	genCurSort(text: string, offset: number) {
		const filters = this.forumFilters;
		text = text.toLowerCase();
		let match = this.children.filter((thread) => thread.name.toLowerCase().includes(text));
		const tagSet = new Set(filters.tags);
		if (tagSet.size)
			match = match.filter((thread) => {
				const tags = new Set(thread.appliedTags);
				if (filters.tagMatchAll) {
					return tagSet.isSubsetOf(tags);
				} else {
					return tags.intersection(tagSet).size;
				}
			});
		match.sort((c1, c2) => {
			const order = filters.sortActive
				? SnowFlake.compareIds(c1.lastmessageid || c1.id, c2.lastmessageid || c2.id)
				: SnowFlake.compareIds(c1.id, c2.id);
			return filters.recentFirst ? -order : order;
		});

		return [match.slice(offset, offset + 25), !!match.at(offset + 25)] as const;
	}

	async findMatches(text: string, offset: number): Promise<readonly [Channel[], boolean]> {
		if (this.hasAllThreads) return this.genCurSort(text, offset);

		const filters = this.forumFilters;
		const uid = `${filters.recentFirst}-${filters.sortActive}-${filters.tagMatchAll}-${filters.tags.join("-")}-${text}`;
		let offset2 = 0;
		let lastid = "";
		if (text) {
			[, offset2, lastid] = this.search.find(([id]) => id === uid) || ["", 0, ""];
		} else {
			[offset2, lastid] = this.umap.get(uid) || [0, ""];
		}

		if (lastid) {
			const [list, more] = this.genCurSort(text, offset);
			for (const elm of list) {
				if (elm.id === lastid) {
					await this.fetchThreads(text, offset2);
					return this.genCurSort(text, offset);
				}
			}
			return [list, more];
		} else {
			await this.fetchThreads(text, offset2);
			return this.genCurSort(text, offset);
		}
	}

	async forumSearch(text: string, div: HTMLDivElement) {
		if (!this.hasFetchedForForum) {
			try {
				await (this.forumFetch ??= this.fetchForum().finally(() => {
					this.forumFetch = undefined;
				}));
			} catch (e) {
				const refused = e instanceof Error && e.cause instanceof Response ? e.cause : undefined;
				// A clone: every search that shared the request reads the same refusal's body
				// (one fetchForum already read, an unreadable answer, gives its status).
				const reason = await refusalText(refused?.bodyUsed ? refused : refused?.clone());
				// Without the posts' first messages every preview would read as deleted: say why
				// there's no list, and offer another go (unless another search has fetched it since).
				if (!this.hasFetchedForForum) {
					const why = document.createElement("p");
					why.textContent = reason;
					const again = document.createElement("button");
					again.textContent = I18n.tryAgain();
					again.onclick = () => {
						again.disabled = true;
						void this.forumSearch(text, div);
					};
					div.replaceChildren(why, again);
					return;
				}
			}
		}
		let offset = 0;
		const flipPage = async (by: number) => {
			offset += by;
			div.scrollTop = 0;
			const [match, more] = await this.findMatches(text, offset);

			await renderDiv(match, more);
		};
		// A changed filter or sort is a new list: it starts at its first page.
		const refilter = () => {
			offset = 0;
			return flipPage(0);
		};

		const renderDiv = async (threads: Channel[], more: boolean) => {
			div.innerHTML = "";

			const sortRow = document.createElement("div");
			sortRow.classList.add("flexltr", "forumSortRow");
			div.append(sortRow);

			const cMenu = new Contextmenu<void, void>("sortAndStuff");
			const opts = I18n.forum.sortOptions;

			cMenu.addText(opts.sortby.title());
			cMenu.addButton(
				opts.sortby.recent(),
				() => {
					this.forumFilters.sortActive = true;
					refilter();
				},
				{
					icon: {
						css: this.forumFilters.sortActive ? "svg-select" : "svg-noSelect",
					},
				},
			);
			cMenu.addButton(
				opts.sortby.posted(),
				() => {
					this.forumFilters.sortActive = false;
					refilter();
				},
				{
					icon: {
						css: this.forumFilters.sortActive ? "svg-noSelect" : "svg-select",
					},
				},
			);
			cMenu.addSeperator();

			cMenu.addText(opts.sortOrder.title());
			cMenu.addButton(
				opts.sortOrder.recent(),
				() => {
					this.forumFilters.recentFirst = true;
					refilter();
				},
				{
					icon: {
						css: this.forumFilters.recentFirst ? "svg-select" : "svg-noSelect",
					},
				},
			);

			cMenu.addButton(
				opts.sortOrder.old(),
				() => {
					this.forumFilters.recentFirst = false;
					refilter();
				},
				{
					icon: {
						css: this.forumFilters.recentFirst ? "svg-noSelect" : "svg-select",
					},
				},
			);
			cMenu.addSeperator();

			cMenu.addText(opts.tagMatch.title());
			cMenu.addButton(
				opts.tagMatch.some(),
				() => {
					this.forumFilters.tagMatchAll = false;
					refilter();
				},
				{
					icon: {css: this.forumFilters.tagMatchAll ? "svg-noSelect" : "svg-select"},
				},
			);
			cMenu.addButton(
				opts.tagMatch.all(),
				() => {
					this.forumFilters.tagMatchAll = true;
					refilter();
				},
				{
					icon: {
						css: this.forumFilters.tagMatchAll ? "svg-select" : "svg-noSelect",
					},
				},
			);

			const sortOptionButton = document.createElement("button");
			sortOptionButton.textContent = opts.name();

			sortOptionButton.onclick = (e) => {
				if (e.button !== 0) return;
				e.preventDefault();
				e.stopImmediatePropagation();
				const box = sortOptionButton.getBoundingClientRect();
				cMenu.makemenu(box.left, box.bottom + 6);
			};

			const tags = document.createElement("div");
			tags.classList.add("forumTagSelect");

			const allMenu = new Contextmenu<void, void>("allTagMenu");

			for (const tag of this.availableTags) {
				const html = tag.makeHTML();
				if (this.forumFilters.tags.includes(tag.id)) html.classList.add("selected");
				html.onclick = () => {
					if (this.forumFilters.tags.includes(tag.id)) {
						this.forumFilters.tags = this.forumFilters.tags.filter((id) => id !== tag.id);
					} else {
						this.forumFilters.tags.push(tag.id);
						this.forumFilters.tags.sort();
					}
					refilter();
				};
				tags.append(html);
				allMenu.addButton(
					tag.name,
					() => {
						if (this.forumFilters.tags.includes(tag.id)) {
							this.forumFilters.tags = this.forumFilters.tags.filter((id) => id !== tag.id);
						} else {
							this.forumFilters.tags.push(tag.id);
							this.forumFilters.tags.sort();
						}
						refilter();
					},
					{
						icon: {css: this.forumFilters.tags.includes(tag.id) ? "svg-select" : "svg-noSelect"},
					},
				);
			}

			const allTags = document.createElement("button");
			allTags.classList.add("allTagButton");
			allTags.textContent = I18n.forum.allTags();

			allTags.onclick = (e) => {
				if (e.button !== 0) return;
				e.preventDefault();
				e.stopImmediatePropagation();
				const box = allTags.getBoundingClientRect();
				allMenu.makemenu(box.right - window.innerWidth, box.bottom + 6);
			};

			sortRow.append(sortOptionButton, tags, allTags);

			div.append(...(await Promise.all(threads.map((_) => _.renderThread()))));

			const buttonRow = document.createElement("div");
			buttonRow.classList.add("flexltr", "forumButtonRow");

			const next = document.createElement("button");
			next.textContent = I18n.forum.next();
			next.disabled = !more;
			if (more) {
				next.onclick = () => {
					flipPage(25);
				};
			}

			const back = document.createElement("button");
			back.textContent = I18n.forum.back();
			back.disabled = !offset;
			if (offset) {
				back.onclick = () => {
					flipPage(-25);
				};
			}

			buttonRow.append(back, next);
			div.append(buttonRow);
		};
		await flipPage(0);
	}
	renderForum() {
		(document.getElementById("typediv") as HTMLElement).style.visibility = "hidden";
		const container = document.createElement("div");

		container.classList.add("messagecontainer", "flexttb", "forumBody");
		(document.getElementById("scrollWrap") as HTMLElement).append(container);
		const superContainer = document.createElement("div");
		superContainer.classList.add("forumHead", "flexttb");
		const headContainer = document.createElement("div");
		superContainer.append(headContainer);
		headContainer.classList.add("flexltr");
		container.append(superContainer);

		const icon = document.createElement("span");
		icon.classList.add("svgicon", "svg-search", "forumIcon");
		headContainer.append(icon);

		const text = document.createElement("input");
		text.type = "text";
		text.classList.add("forumSearch");
		headContainer.append(text);
		text.placeholder = I18n.forum.creorsear();

		const post = document.createElement("button");
		post.textContent = I18n.forum.newPost();
		post.classList.add("newPostForumButton");
		headContainer.append(post);

		post.onclick = () => {
			let posting = false;
			const postF = async () => {
				if (this.flags & (1 << 4) && !tagList.length) {
					showError(I18n.forum.errors.tagsReq());
					return;
				}
				const content = md.rawString;
				if (!content) {
					showError(I18n.forum.errors.requireText());
					return;
				}
				// One post per tap: a second tap while this one is out would post it twice.
				if (posting) return;
				posting = true;
				post.disabled = true;
				let created: string | undefined;
				try {
					const res = await fetch(this.info.api + "/channels/" + this.id + "/threads", {
						method: "POST",
						headers: this.headers,
						body: JSON.stringify({
							name: text.value,
							applied_tags: tagList,
							message: {
								content,
							},
						}),
					});
					const json = (await res.json().catch(() => null)) as channeljson | null;
					if (!res.ok || !json?.id) {
						showError(sendErrorText(json as Parameters<typeof sendErrorText>[0]));
						return;
					}
					created = json.id;
				} catch {
					showError(I18n.requestFailed("offline"));
				} finally {
					posting = false;
					post.disabled = false;
				}
				if (created) this.localuser.goToChannel(created);
			};
			post.onclick = postF;
			post.textContent = I18n.forum.post();
			const box = document.createElement("div");
			box.classList.add("messageEditContainer");
			const area = document.createElement("div");
			const sb = document.createElement("div");
			sb.style.position = "absolute";
			sb.style.width = "100%";
			const search = document.createElement("div");
			search.classList.add("searchOptions", "flexttb");
			area.classList.add("editMessage");
			try {
				area.contentEditable = "plaintext-only";
			} catch {
				area.contentEditable = "true";
			}
			const md = new MarkDown("", this, {keep: true});
			area.append(md.makeHTML());
			area.addEventListener("keyup", (event) => {
				if (this.localuser.keyup(event)) return;
			});
			area.addEventListener("keydown", (event) => {
				this.localuser.keydown(event);
			});
			md.giveBox(area, (str, pre) => {
				this.localuser.search(search, md, str, pre);
			});
			sb.append(search);
			box.append(sb, area);
			superContainer.append(box);
			setTimeout(() => {
				area.focus();
				const fun = saveCaretPosition(area, Infinity);
				if (fun) fun();
			});
			box.oncontextmenu = (e) => {
				e.stopImmediatePropagation();
			};

			let tagList: string[] = [];

			const tags = document.createElement("div");
			tags.classList.add("forumTagSelect");
			for (const tag of this.availableTags.filter(
				(tag) => !tag.moderated || this.hasPermission("MANAGE_THREADS"),
			)) {
				const html = tag.makeHTML();
				html.onclick = () => {
					if (tagList.includes(tag.id)) {
						tagList = tagList.filter((id) => id !== tag.id);
						html.classList.remove("selected");
					} else {
						tagList.push(tag.id);
						tagList.sort();
						html.classList.add("selected");
					}
				};
				tags.append(html);
			}
			superContainer.append(tags);
			function showError(text: string) {
				errorText.textContent = text;
				setTimeout(() => {
					errorText.textContent = "";
				}, 5000);
			}

			const errorText = document.createElement("span");
			errorText.classList.add("forumPostError");
			superContainer.append(errorText);
		};

		const theadList = document.createElement("div");
		theadList.classList.add("flexttb", "forumList");
		container.append(theadList);

		let curidsearch = 0;
		text.onkeyup = async () => {
			const thisid = ++curidsearch;
			await new Promise((res) => setTimeout(res, 120));
			if (thisid !== curidsearch) return;
			this.forumSearch(text.value, theadList);
		};
		this.forumSearch("", theadList);
	}
	async getHTML(addstate = true, getMessages: boolean | void = undefined, aroundMessage?: string) {
		if (!this.visible) {
			// Awaited so the caller sees the visible fallback focused when this returns.
			await this.guild.loadChannel();
			return;
		}
		if (this.guild_id === "@me") {
			(this.owner as Guild & {freindDiv?: HTMLDivElement}).freindDiv?.classList.remove(
				"viewChannel",
			);
		}
		if (this.localuser.channelfocus) {
			this.localuser.channelfocus.collectBox();
		}
		const typebox = document.getElementById("typebox") as CustomHTMLDivElement;
		typebox.markdown.boxEnabled = !this.curCommand;
		if (this.curCommand) {
			this.curCommand.render(typebox, this);
		}
		typebox.style.setProperty("--channel-text", JSON.stringify(I18n.channel.typebox(this.name)));
		if (!this.curCommand && !this.isForum()) {
			const md = typebox.markdown;
			md.owner = this;
			if (!this.textSave) {
				this.textSave = this.getStoredDraft();
			}
			md.txt = this.textSave;
			if (this.textSave) {
				typebox.textContent = this.textSave;
				md.boxupdate(Infinity);
				setTimeout(() => {
					const selection = window.getSelection();
					if (selection && typebox.lastChild) {
						const range = new Range();
						let lastNode = typebox.lastChild;
						while (lastNode.lastChild && !(lastNode instanceof Text)) {
							lastNode = lastNode.lastChild;
						}
						if (lastNode instanceof Text) {
							range.setStart(lastNode, lastNode.length);
							range.setEnd(lastNode, lastNode.length);
						} else {
							range.setStartAfter(lastNode);
							range.setEndAfter(lastNode);
						}
						selection.removeAllRanges();
						selection.addRange(range);
					}
				}, 0);
			} else {
				md.boxupdate(Infinity);
			}
		}
		if (this.isForum()) {
			typebox.markdown.txt = "";
		}
		this.localuser.fileExtange(this.files, this.htmls);

		if (getMessages === undefined) {
			getMessages = this.type !== 2 || !this.localuser.voiceAllowed;
		}

		const messages = document.getElementById("scrollWrap") as HTMLDivElement;
		const messageContainers = Array.from(messages.getElementsByClassName("messagecontainer"));
		for (const thing of messageContainers) {
			thing.remove();
		}
		const chatArea = document.getElementById("chatArea") as HTMLElement;

		const voiceArea = document.getElementById("voiceArea") as HTMLElement;
		voiceArea.innerHTML = "";
		if (getMessages && this.type !== 2) {
			chatArea.style.removeProperty("display");
		} else {
			if (this.voiceMode === "VoiceOnly") {
				chatArea.style.setProperty("display", "none");
			} else {
				chatArea.style.removeProperty("display");
				getMessages = true;
			}
			this.setUpVoiceArea();
			this.localuser.memberListUpdate();
		}

		const pinnedM = document.getElementById("pinnedMDiv");
		if (pinnedM) {
			if (this.unreadPins()) {
				pinnedM.classList.add("unreadPin");
			} else {
				pinnedM.classList.remove("unreadPin");
			}
		}
		if (addstate) {
			history.pushState(
				[this.guild_id, this.id, aroundMessage],
				"",
				"/channels/" + this.guild_id + "/" + this.id + (aroundMessage ? `/${aroundMessage}` : ""),
			);
			// A navigation push closes the mobile members view (the owner's call, Discord's app
			// behavior) — AFTER the push: the view's marker entry is then no longer top, so
			// the close issues no history.back() of its own (a same-task back-then-push
			// interleave would let the traversal swallow the entry just pushed). The buried
			// marker stays transparent to back via the skip rule in consumeMembersPop. The
			// search view closes on navigation the same way (18b).
			closeMembersOnNavigation();
			closeSearchOnNavigation();
		}
		this.localuser.pageTitle(
			this.guild_id === "@me" ? this.name : "#" + this.name,
			this.guild.properties.name,
		);
		const channelTopic = document.getElementById("channelTopic") as HTMLSpanElement;
		if (this.topic) {
			channelTopic.innerHTML = "";
			channelTopic.append(new MarkDown(this.topic, this).makeHTML());
			channelTopic.removeAttribute("hidden");
			channelTopic.onclick = () => {
				const d = new Dialog(this.name);
				d.options.addHTMLArea(new MarkDown(this.topic, this).makeHTML());
				d.show();
			};
		} else {
			channelTopic.setAttribute("hidden", "");
			channelTopic.onclick = () => {};
		}
		if (this.guild !== this.localuser.lookingguild) {
			this.guild.loadGuild();
		}

		if (this.localuser.channelfocus && this.localuser.channelfocus.myhtml) {
			this.localuser.channelfocus.myhtml.classList.remove("viewChannel");
		}
		if (this.myhtml) {
			this.myhtml.classList.add("viewChannel");
		}
		const id = ++Channel.genid;

		if (this.localuser.channelfocus && this.localuser.channelfocus !== this) {
			this.localuser.channelfocus.infinite.delete();

			if (this.localuser.channelfocus.isThread() && !this.localuser.channelfocus.member) {
				const prev = this.localuser.channelfocus;
				this.localuser.channelfocus = this;
				prev.parent?.createguildHTML();
			}
		} else if (this.localuser.channelfocus === this && !aroundMessage && !this.isForum()) {
			if (this.lastmessageid)
				this.infinite.focus(aroundMessage || this.lastmessageid, !!aroundMessage, true);
			return;
		}
		this.guild.prevchannel = this;
		this.guild.perminfo.prevchannel = this.id;
		this.localuser.channelfocus = this;
		// A refused send's notice belongs to the channel it happened in.
		Channel.clearSendError();

		if (this.isThread() && !this.member) {
			this.parent?.createguildHTML();
			if (this.myhtml) {
				this.myhtml.classList.add("viewChannel");
			}
		}

		if (this.nsfwGated()) {
			this.nsfwPannel();
			return;
		}
		this.slowmode();
		this.localuser.getSidePannel();
		if (this.isForum()) {
			this.renderForum();
			return;
		}

		const prom = this.infinite.delete();
		if (getMessages) {
			const loading = document.getElementById("loadingdiv") as HTMLDivElement;
			Channel.regenLoadingMessages();
			loading.classList.add("loading");
		}
		this.rendertyping();

		this.refreshComposerLock();
		(document.getElementById("typediv") as HTMLElement).style.visibility = "visible";
		if (!mobile) {
			(document.getElementById("typebox") as HTMLDivElement).focus();
		} else {
			(document.getElementById("typebox") as HTMLDivElement).blur();
		}
		if (getMessages) {
			this.beginFirstPageOpen();
			await this.putmessages();
		}

		await prom;
		if (id !== Channel.genid) {
			return;
		}
		this.makereplybox();

		if (getMessages) await this.buildmessages(aroundMessage);
		//loading.classList.remove("loading");
	}
	typingmap: Map<Member | User, number> = new Map();
	async typingStart(typing: startTypingjson): Promise<void> {
		const memb = typing.d.member
			? await Member.new(typing.d.member, this.guild)
			: await this.localuser.getUser(typing.d.user_id);
		if (!memb) return;
		this.typingmap.set(memb, Date.now());
		const user = memb instanceof User ? memb : memb.user;
		user.statusChange();
		setTimeout(() => {
			this.rendertyping();
			user.statusChange();
		}, 10000);
		if (memb.id === this.localuser.user.id) {
			return;
		}
		this.rendertyping();
	}
	similar(str: string) {
		if (this.type === 4) return -1;
		const strl = Math.max(str.length, 1);
		if (this.name.includes(str)) {
			return strl / this.name.length;
		} else if (this.name.toLowerCase().includes(str.toLowerCase())) {
			return strl / this.name.length / 1.2;
		}
		return 0;
	}
	rendertyping(): void {
		const typingtext = document.getElementById("typing") as HTMLDivElement;
		let build = "";
		let showing = false;
		let i = 0;
		const curtime = Date.now() - 5000;
		for (const thing of this.typingmap.keys()) {
			const self = thing.id === this.localuser.user.id;
			if ((this.typingmap.get(thing) as number) > curtime) {
				if (!self) {
					if (i !== 0) {
						build += ", ";
					}
					i++;
					build += thing.name;
					showing = true;
				}
			} else {
				this.typingmap.delete(thing);
			}
		}
		build = I18n.typing(i + "", build);
		if (this.localuser.channelfocus === this) {
			if (showing) {
				typingtext.classList.remove("hidden");
				const typingtext2 = document.getElementById("typingtext") as HTMLDivElement;
				typingtext2.textContent = build;
			} else {
				typingtext.classList.add("hidden");
			}
		}
	}
	static regenLoadingMessages() {
		const loading = document.getElementById("loadingdiv") as HTMLDivElement;
		loading.innerHTML = "";
		for (let i = 0; i < 15; i++) {
			const div = document.createElement("div");
			div.classList.add("loadingmessage");
			if (Math.random() < 0.5) {
				const pfp = document.createElement("div");
				pfp.classList.add("loadingpfp");
				const username = document.createElement("div");
				username.style.width = Math.floor(Math.random() * 96 * 1.5 + 40) + "px";
				username.classList.add("loadingcontent");
				div.append(pfp, username);
			}
			const content = document.createElement("div");
			content.style.width = Math.floor(Math.random() * 96 * 3 + 40) + "px";
			content.style.height = Math.floor(Math.random() * 3 + 1) * 20 + "px";
			content.classList.add("loadingcontent");
			div.append(content);
			loading.append(div);
		}
	}
	lastmessage: Message | undefined;
	setnotifcation() {
		const optionsArr = ["all", "onlyMentions", "none", "default"] as const;
		const defualt = I18n.guild[optionsArr[this.guild.message_notifications]]();
		const options = optionsArr.map((e) => I18n.guild[e](defualt));
		const notiselect = new Dialog("");
		const form = notiselect.options.addForm(
			"",
			(_, sent: any) => {
				notiselect.hide();
				this.message_notifications = sent.channel_overrides[this.id].message_notifications;
			},
			{
				fetchURL: `${this.info.api}/users/@me/guilds/${this.guild.id}/settings/`,
				method: "PATCH",
				headers: this.headers,
			},
		);
		form.addSelect(
			I18n.guild.selectnoti(),
			"message_notifications",
			options,
			{
				radio: true,
				defaultIndex: this.message_notifications,
			},
			[0, 1, 2, 3],
		);

		form.addPreprocessor((e: any) => {
			const message_notifications = e.message_notifications;
			delete e.message_notifications;
			e.channel_overrides = {
				[this.id]: {
					message_notifications,
					muted: this.muted,
					mute_config: this.mute_config,
					channel_id: this.id,
				},
			};
		});
		notiselect.show();
	}
	/** Set when the opening page of history was refused or never came: the channel is
	 * unloaded, not empty. */
	private firstPageRefused = false;
	/** The last refusal was a rate limit, whose own window says when to ask again. */
	private firstPageRateLimited = false;
	/** The opening page's consecutive refusals; an open the user makes starts the count over. */
	private firstPageRefusals?: number;
	/** What an open the user makes (getHTML's build path) resets before fetching the opening page. */
	beginFirstPageOpen() {
		this.firstPageRefusals = 0;
		// The open's own fetch supersedes any re-ask still waiting out a window. Called below
		// getHTML's in-view early return, so a click on the channel already in view leaves it be.
		this.reaskToken = (this.reaskToken ?? 0) + 1;
	}
	/** The most times one open asks for a refused opening page before it gives up. */
	private static readonly firstPageAttempts = 3;
	async putmessages() {
		//TODO swap out with the WS op code
		if (this.allthewayup) {
			return;
		}
		if (this.lastreadmessageid && this.messages.has(this.lastreadmessageid)) {
			return;
		}
		const j = await fetch(this.info.api + "/channels/" + this.id + "/messages?limit=100", {
			headers: this.headers,
		}).catch(() => undefined);
		if (j?.status === 429) {
			// A rate limit says nothing about where the channel's history ends: arm the window
			// the paging loop shares, and leave the channel unloaded.
			Channel.historyCooldownUntil = Date.now() + (await Channel.rateLimitWait(j));
			this.firstPageRefused = true;
			this.firstPageRateLimited = true;
			this.firstPageRefusals = (this.firstPageRefusals ?? 0) + 1;
			return;
		}
		this.firstPageRateLimited = false;
		// Any other failure says no more about where the history ends: refused, not the top.
		const body: unknown = j?.ok ? await j.json().catch(() => undefined) : undefined;
		if (!Array.isArray(body)) {
			this.firstPageRefused = true;
			this.firstPageRefusals = (this.firstPageRefusals ?? 0) + 1;
			return;
		}
		this.firstPageRefused = false;
		this.firstPageRefusals = 0;

		const response = body as messagejson[];
		if (response.length !== 100) {
			this.allthewayup = true;
		}
		// A live message can land while the page is on its way: the page, made before it, mustn't
		// wind the channel's newest back (MESSAGE_CREATE has already linked it after the page's).
		const liveNewer = (pageNewest?: string) => {
			const known = this.lastmessageid;
			if (!known || !this.messages.has(known)) return false;
			if (pageNewest === undefined) return true;
			try {
				return BigInt(known) > BigInt(pageNewest);
			} catch {
				// A pending send ("fake…" id) is newer than anything the server has.
				return known !== pageNewest;
			}
		};
		let prev: Message | undefined;
		for (const thing of response) {
			const message = new Message(thing, this);
			if (prev) {
				this.idToNext.set(message.id, prev.id);
				this.idToPrev.set(prev.id, message.id);
			} else if (!liveNewer(message.id)) {
				this.lastmessage = message;
				this.setLastMessageId(message.id);
			}
			prev = message;
		}
		if (!response.length && !liveNewer()) {
			this.lastmessageid = undefined;
			this.lastreadmessageid = undefined;
		}
		await this.slowmode();
	}
	delChannel(json: channeljson) {
		const build: Channel[] = [];
		for (const thing of this.children) {
			if (thing.id !== json.id) {
				build.push(thing);
			}
		}
		this.children = build;
	}
	afterProm?: Promise<void>;
	afterProms = new Map<string, () => void>();
	/** Resolves once the page after `id` lands (or fails); several callers can wait on one id. */
	private waitForAfter(id: string) {
		return new Promise<void>((res) => {
			const earlier = this.afterProms.get(id);
			this.afterProms.set(id, earlier ? () => (earlier(), res()) : res);
		});
	}
	async grabAfter(id: string) {
		// Pending (fake) sends have no history after them: page from the newest real message.
		let tempy: string | undefined = id;
		while (tempy && tempy.includes("fake")) {
			tempy = this.idToPrev.get(tempy);
		}
		if (!tempy) return;
		id = tempy;
		if (this.idToNext.has(id) || id === this.lastmessage?.id) return;
		// A page is already loading: wait for this id's turn under the id a page links from.
		if (this.afterProm) return this.waitForAfter(id);
		const waiter = this.waitForAfter(id);
		this.afterProm = new Promise(async (res) => {
			const messages = await this.fetchHistoryPage("after=" + id);
			if (!messages) {
				this.historyFailures++;
				// As in grabBefore: nothing recorded, every waiter released, asked again later.
				settleWaiters(this.afterProms);
				this.afterProm = undefined;
				res();
				return;
			}
			try {
				let previd: string = id;
				for (const response of messages) {
					let messager: Message;
					let willbreak = false;
					if (this.messages.has(response.id)) {
						messager = this.messages.get(response.id) as Message;
						willbreak = true;
					} else {
						messager = new Message(response, this);
					}
					this.idToPrev.set(messager.id, previd);
					this.idToNext.set(previd, messager.id);

					const res = this.afterProms.get(previd);
					if (res) {
						res();
						this.afterProms.delete(previd);
					}

					previd = messager.id;
					if (willbreak) {
						break;
					}
				}
				// Only an empty page means nothing newer: a page whose first message is already loaded
				// has just linked to it.
				if (messages.length === 0) {
					this.idToNext.set(id, undefined);
				}
				{
					const res = this.afterProms.get(previd);
					if (res) {
						res();
						this.afterProms.delete(previd);
					}
				}
				res();
				this.afterProm = undefined;
				if (this.afterProms.size !== 0) {
					const [id] = this.afterProms.entries().next().value as [string, () => void];
					this.grabAfter(id);
				}
			} catch (e) {
				// A page whose messages can't be built fails like a page that never came.
				console.error(e);
				this.historyFailures++;
				settleWaiters(this.afterProms);
				this.afterProm = undefined;
				res();
			}
		});
		return waiter;
	}
	async getArround(id: string) {
		if (!this.messages.has(id)) {
			await this.getmessage(id);
		}
		await Promise.all([this.grabBefore(id), this.grabAfter(id)]);
	}
	topid!: string;
	beforeProm?: Promise<void>;
	beforeProms = new Map<string, () => void>();
	/** Resolves once the page before `id` lands (or fails); several callers can wait on one id. */
	private waitForBefore(id: string) {
		return new Promise<void>((res) => {
			const earlier = this.beforeProms.get(id);
			this.beforeProms.set(id, earlier ? () => (earlier(), res()) : res);
		});
	}
	async grabBefore(id: string) {
		if (this.topid && id === this.topid) {
			return;
		}
		// Pending (fake) sends sit above real history: page from the newest real message.
		let tempy: string | undefined = id;
		while (tempy && tempy.includes("fake")) {
			tempy = this.idToPrev.get(tempy);
		}
		if (!tempy) return;
		id = tempy;
		// A page is already loading: wait for this id's turn (the loader pages any id still
		// waiting when it finishes) instead of taking the other id's page as this one's.
		if (this.beforeProm) return this.idToPrev.has(id) ? undefined : this.waitForBefore(id);
		// Registered before the fetch starts, under the id the page links from.
		const waiter = this.waitForBefore(id);
		this.beforeProm = new Promise<void>(async (res) => {
			const messages = await this.fetchHistoryPage("before=" + id);
			if (!messages) {
				this.historyFailures++;
				// A failed page (network, 429, 5xx) records nothing: the ids stay unlinked, so
				// the scroller asks again on the next scroll instead of waiting forever.
				settleWaiters(this.beforeProms);
				this.beforeProm = undefined;
				res();
				return;
			}
			try {
				// Every message is built before any link, waiter or topid write: a page that
				// throws while building leaves the channel untouched for the retry.
				const built = messages.map((response) =>
					this.messages.has(response.id)
						? (this.messages.get(response.id) as Message)
						: new Message(response, this),
				);
				let previd = id;
				let i = 0;
				for (const messager of built) {
					this.idToNext.set(messager.id, previd);
					this.idToPrev.set(previd, messager.id);

					const res = this.beforeProms.get(previd);
					if (res) {
						res();
						this.beforeProms.delete(previd);
					}

					previd = messager.id;

					if (i < 99) {
						this.topid = previd;
					}

					i++;
				}
				if (i < 100) {
					this.allthewayup = true;
					if (i === 0) {
						this.topid = id;
						this.idToPrev.set(id, undefined);
					}
				}
				{
					const res = this.beforeProms.get(previd);
					if (res) {
						res();
						this.beforeProms.delete(previd);
					}
				}
				this.beforeProm = undefined;
				res();
				if (this.beforeProms.size !== 0) {
					const [id] = this.beforeProms.entries().next().value as [string, () => void];
					this.grabBefore(id);
				}
			} catch (e) {
				// As in grabAfter: a page that can't be built fails like one that never came.
				console.error(e);
				this.historyFailures++;
				settleWaiters(this.beforeProms);
				this.beforeProm = undefined;
				res();
			}
		});
		return waiter;
	}
	/** Counts failed history pages, so a scroller lookup that came back unlinked can tell a
	 * failure (retry later) from the channel's real end. */
	private historyFailures = 0;
	/** The rate-limit window shared by every channel's history loop (test-visible: the
	 * suite resets it). */
	static historyCooldownUntil = 0;
	/** A 429's wait: Spacebar's body carries retry_after in SECONDS. Capped for sanity. */
	private static async rateLimitWait(res: Response, cap = 30_000): Promise<number> {
		return retryAfterMs(429, await res.text().catch(() => null), cap)!;
	}
	/** One page of this channel's history, or undefined when the request failed (network
	 * error, an error status, a body that isn't a message list). */
	private async fetchHistoryPage(query: string): Promise<messagejson[] | undefined> {
		// A rate-limited window is shared: ticks inside it fail fast instead of re-issuing
		// the same request on every scroll tick, while the caller that hit the limit waits
		// (capped) and retries once itself.
		if (Date.now() < Channel.historyCooldownUntil) return undefined;
		// Whether this call has put a window up; only a window it armed is its to release.
		let armed = false;
		try {
			let res = await fetch(
				this.info.api + "/channels/" + this.id + "/messages?limit=100&" + query,
				{headers: this.headers},
			);
			if (res.status === 429) {
				const wait = await Channel.rateLimitWait(res);
				Channel.historyCooldownUntil = Date.now() + wait;
				armed = true;
				await new Promise((r) => setTimeout(r, wait));
				res = await fetch(
					this.info.api + "/channels/" + this.id + "/messages?limit=100&" + query,
					{headers: this.headers},
				);
				// The retry's answer owns the window now: a second 429 re-arms it from its own
				// wait, anything else releases the other ticks (a network error does in the catch).
				if (res.status === 429) {
					Channel.historyCooldownUntil = Date.now() + (await Channel.rateLimitWait(res));
				} else {
					// Released here: a later failure of this call has no window left to clear.
					Channel.historyCooldownUntil = 0;
					armed = false;
				}
			}
			if (!res.ok) return undefined;
			const json: unknown = await res.json();
			return Array.isArray(json) ? (json as messagejson[]) : undefined;
		} catch (e) {
			console.error(e);
			// A failure after this call armed a window releases it; a failure that armed
			// nothing leaves another call's window alone.
			if (armed) Channel.historyCooldownUntil = 0;
			return undefined;
		}
	}
	async buildmessages(id: string | void) {
		this.infinitefocus = false;
		await this.tryfocusinfinate(id, !!id);
	}
	infinitefocus = false;
	/** Counts this channel's builds, so a pending first-page re-ask can tell a newer build of
	 * the channel from a click that didn't rebuild it. */
	private reaskToken?: number;
	/** The generation of this channel's latest build, the one `infinitefocus` belongs to. */
	private buildGen = 0;
	async tryfocusinfinate(id: string | void, flash = false) {
		// Claimed before the jump target's lookup: a message arriving meanwhile would otherwise
		// start its own build, at the last-read message, in the jump's place.
		if (this.infinitefocus) return;
		this.infinitefocus = true;
		const gid = ++Channel.genid;
		this.buildGen = gid;
		// A newer build of this channel supersedes any re-ask still waiting out a window.
		this.reaskToken = (this.reaskToken ?? 0) + 1;
		// Overtaken (a channel switch, or getHTML re-opening this channel): the claim goes too,
		// unless a newer build of this channel holds it now.
		const abandon = () => {
			if (this.buildGen === gid) this.infinitefocus = false;
		};
		const loading = document.getElementById("loadingdiv") as HTMLDivElement;
		try {
			if (typeof id === "string" && !this.messages.has(id)) await this.getmessage(id);
			if (gid !== Channel.genid) return abandon();
			const messages = document.getElementById("scrollWrap") as HTMLDivElement;
			const messageContainers = Array.from(messages.getElementsByClassName("messagecontainer"));
			for (const thing of messageContainers) {
				thing.remove();
			}
			const removetitle = document.getElementById("removetitle");
			//messages.innerHTML="";
			if (!id) {
				if (this.lastreadmessageid && this.messages.has(this.lastreadmessageid)) {
					id = this.lastreadmessageid;
				} else if (this.lastreadmessageid && (id = this.findClosest(this.lastreadmessageid))) {
				} else if (this.lastmessageid && this.messages.has(this.lastmessageid)) {
					id = this.goBackIds(this.lastmessageid, 50);
				}
			}
			if (!id && this.firstPageRefused) {
				// Nothing came, but that isn't the channel's emptiness: no empty-channel title, no
				// recorded end.
				this.infinitefocus = false;
				const refusals = this.firstPageRefusals ?? 0;
				if (refusals >= Channel.firstPageAttempts) {
					// Out of attempts: the skeleton goes, the pane says the messages couldn't load,
					// and nothing is recorded, so the next open asks again.
					const title = document.createElement("h2");
					title.id = "loadfailedtitle";
					title.textContent = I18n.messagesLoadFailed();
					title.classList.add("titlespace", "messagecontainer");
					messages.append(title);
					loading.classList.remove("loading");
					return;
				}
				// The skeleton stays up. Once the rate limit's window ends, or after a backoff for
				// any other refusal (1 s, then 2 s), the channel asks again by the same two steps
				// getHTML takes, if it is still the one on screen.
				const cooldownRemaining = Math.max(0, Channel.historyCooldownUntil - Date.now());
				const backoff = refusals >= 1 ? 1000 * 2 ** (refusals - 1) : 0;
				const wait = this.firstPageRateLimited
					? cooldownRemaining
					: Math.max(cooldownRemaining, backoff);
				const token = this.reaskToken;
				// The token (not the global generation, which any click on the channel in view
				// bumps) says no newer build of this channel has started; the focus check says
				// the user is still here. Both are checked again after the fetch.
				const current = () => this.localuser.channelfocus === this && token === this.reaskToken;
				setTimeout(async () => {
					if (!current()) return;
					try {
						await this.putmessages();
						if (!current()) return;
						await this.buildmessages();
					} catch (e) {
						console.error(e);
					}
				}, wait);
				return;
			}
			if (!id) {
				if (!removetitle) {
					const title = document.createElement("h2");
					title.id = "removetitle";
					title.textContent = I18n.noMessages();
					title.classList.add("titlespace", "messagecontainer");
					messages.append(title);
				}
				this.infinitefocus = false;
				loading.classList.remove("loading");
				return;
			} else if (removetitle) {
				removetitle.remove();
			}
			if (this.localuser.channelfocus !== this) {
				this.infinitefocus = false;
				return;
			}
			Channel.clearScrollWrapLeaks();
			const div = await this.infinite.getDiv(id, flash);
			if (gid !== Channel.genid) return abandon();
			messages.append(div);
			/*
			await this.infinite.watchForChange().then(async (_) => {
				//await new Promise(resolve => setTimeout(resolve, 0));

				await this.infinite.focus(id, falsh); //if someone could figure out how to make this work correctly without this, that's be great :P


				this.infinite.focus(id, falsh, true);
			});
			*/
			await this.focus(id, flash);
			loading.classList.remove("loading");
			//this.infinite.focus(id.id,false);
		} catch (e) {
			abandon();
			// The skeleton belongs to whichever build is newest.
			if (gid === Channel.genid) loading?.classList.remove("loading");
			throw e;
		}
	}
	private goBackIds(id: string, back: number, returnifnotexistant = true): string | undefined {
		while (back !== 0) {
			const nextid = this.idToPrev.get(id);
			if (nextid) {
				id = nextid;
				back--;
			} else {
				if (returnifnotexistant) {
					break;
				} else {
					return undefined;
				}
			}
		}
		return id;
	}
	private findClosest(id: string | undefined) {
		const mTime = (id: string) => {
			return this.messages.get(id)?.getTimeStamp() || -1;
		};
		if (!this.lastmessageid || !id) return;
		let flake: string | undefined = this.lastmessageid;
		const time = mTime(id);
		let flaketime = mTime(flake);
		while (flake && time < flaketime) {
			flake = this.idToPrev.get(flake);

			if (!flake) {
				return;
			}
			flaketime = mTime(flake);
		}
		return flake;
	}
	nameSpan = new WeakRef(document.createElement("span") as HTMLElement);
	updateChannel(json: channeljson) {
		this.type = json.type;
		if (json.flags !== undefined) this.flags = json.flags;
		this.name = json.name;
		this.position = json.position;
		this.owner_id = json.owner_id;
		this.icon = json.icon;
		this.defaultAutoArchiveDuration = json.default_auto_archive_duration;
		this.renderIcon();
		this.threadData = json.thread_metadata;
		this.rate_limit_per_user = json.rate_limit_per_user || 0;
		this.appliedTags = json.applied_tags || this.appliedTags;
		this.availableTags =
			json.available_tags?.map((tag) => new Tag(tag, this)) || this.availableTags;
		this.slowmode();
		this.refreshComposerLock();

		const span = this.nameSpan.deref();
		if (span) span.textContent = this.name;
		const parent = this.localuser.channelids.get(json.parent_id);
		if (parent) {
			this.parent = parent;
			this.parent_id = parent.id;
		} else {
			this.parent = undefined;
			this.parent_id = undefined;
		}

		this.guild_id = json.guild_id;
		const oldover = this.permission_overwrites;
		this.permission_overwrites = new Map();
		this.permission_overwritesar = (json.permission_overwrites ?? []).map((r) => {
			const p = new Permissions(r.allow, r.deny);
			this.permission_overwrites.set(r.id, p);
			return [r.id, p];
		});
		const nchange = [...new Set<string>().union(oldover).difference(this.permission_overwrites)];
		const pchange = [...new Set<string>().union(this.permission_overwrites).difference(oldover)];
		for (const thing of nchange) {
			const role = this.guild.roleids.get(thing);
			if (role) {
				this.croleUpdate(role, new Permissions("0"), false);
			} else {
				const user = this.localuser.getUser(thing);
				user.then((_) => {
					if (_) this.croleUpdate(_, new Permissions("0"), false);
				});
			}
		}
		for (const thing of pchange) {
			const role = this.guild.roleids.get(thing);
			const perms = this.permission_overwrites.get(thing);
			if (role && perms) {
				this.croleUpdate(role, perms, true);
			} else if (perms) {
				const user = this.localuser.getUser(thing);
				user.then((_) => {
					if (_) this.croleUpdate(_, perms, true);
				});
			}
		}
		this.topic = json.topic;
		this.nsfw = json.nsfw;
		this.fireEvents();
	}
	croleUpdate: (role: Role | User, perm: Permissions, added: boolean) => unknown = () => {};
	typingstart() {
		if (this.typing > Date.now()) {
			return;
		}
		this.typing = Date.now() + 6000;
		// Best-effort: a retry after the typing window died would announce typing that stopped.
		fetchRetryOnce(
			this.info.api + "/channels/" + this.id + "/typing",
			{
				method: "POST",
				headers: this.headers,
			},
			{shouldRetry: () => Date.now() < this.typing},
		).catch(() => {});
	}
	get trueNotiValue() {
		const val = this.notification;
		if (val === "default") {
			switch (Number(this.guild.message_notifications)) {
				case 0:
					return "all";
				case 1:
					return "mentions";
				case 2:
					return "none";
				default:
					return "mentions";
			}
		}

		return val;
	}
	get notification() {
		let notinumber: number | null = this.message_notifications;
		if (Number(notinumber) === 3) {
			notinumber = null;
		}
		notinumber ??= this.guild.message_notifications;
		switch (Number(notinumber)) {
			case 0:
				return "all";
			case 1:
				return "mentions";
			case 2:
				return "none";
			case 3:
			default:
				return "default";
		}
	}
	fakeMessages = new WeakMap<Message, HTMLElement>();
	nonceMap = new Map<string, string>();
	destroyFakeMessage(id: string) {
		const message = this.messages.get(id);
		if (!message) return;
		message.deleteEvent();

		const div = this.fakeMessages.get(message);
		div?.remove();
		this.fakeMessages.delete(message);
		this.messages.delete(id);

		for (const {url} of message.attachments) {
			try {
				URL.revokeObjectURL(url);
			} catch {}
		}
	}

	/**
	 * Leaves a local ephemeral message in this channel when a slash command fails: authored by
	 * the command's bot, naming the command, with the failure text in red and the ephemeral
	 * dismiss footer.
	 */
	async addCommandFailure({
		applicationId,
		label,
		interactionId,
		text,
	}: {
		applicationId: string;
		label?: string;
		interactionId: string;
		text: string;
	}) {
		// A bot's user id is its application's id.
		const bot = await User.resolve(applicationId, this.localuser);
		const m = new Message(
			{
				author: bot.tojson(),
				channel_id: this.id,
				guild_id: this.guild.id,
				id: "fake" + Math.random(),
				content: "",
				timestamp: new Date().toISOString(),
				edited_timestamp: null,
				mentions: [],
				mention_roles: [],
				mention_everyone: false,
				attachments: [],
				tts: false,
				embeds: [],
				reactions: [],
				nonce: "",
				flags: 1 << 6,
				type: 20,
				pinned: false,
				interaction: {
					id: interactionId,
					type: 2,
					name: label ?? "",
					user: this.localuser.user.tojson(),
				},
			},
			this,
		);
		m.commandFailure = text;
		if (!this.lastmessageid) {
			this.topid = m.id;
		}
		if (this.lastmessageid) {
			this.idToNext.set(this.lastmessageid, m.id);
			this.idToPrev.set(m.id, this.lastmessageid);
		}
		this.lastmessage = m;
		this.setLastMessageId(m.id);
		if (this === this.localuser.channelfocus) {
			if (!this.infinitefocus) {
				await this.tryfocusinfinate();
			}
			await this.infinite.addedBottom();
		}
		return m;
	}

	async makeFakeMessage(
		content: string,
		files: filejson[] = [],
		reply = undefined,
		sticker_ids: string[],
		nonce: string,
		embeds: embedjson[] = [],
	) {
		if (this.nonces.has(nonce)) return;
		const m = new Message(
			{
				author: this.localuser.user.tojson(),
				channel_id: this.id,
				guild_id: this.guild.id,
				id: "fake" + Math.random(),
				content: content.trim(),
				timestamp: new Date().toISOString(),
				edited_timestamp: null,
				mentions: [],
				mention_roles: [],
				mention_everyone: false,
				attachments: files,
				tts: false,
				embeds,
				reactions: [],
				nonce,
				type: 0,
				pinned: false,
				message_reference: reply,
				sticker_items: sticker_ids
					.map((_) => {
						return Sticker.getFromId(_, this.localuser);
					})
					.filter((_) => _ !== undefined),
			},
			this,
		);
		if (!this.lastmessageid) {
			this.topid = m.id;
		}
		this.nonceMap.set(nonce, m.id);
		const prev = this.lastmessage;
		const makeRecent = () => {
			if (this.lastmessageid) {
				this.idToNext.set(this.lastmessageid, m.id);
				this.idToPrev.set(m.id, this.lastmessageid);
			}
			this.lastmessage = m;
			this.setLastMessageId(m.id);
		};
		makeRecent();

		const html = m.buildhtml(prev, true);
		html.classList.add("messagediv", "loadingMessage");
		this.fakeMessages.set(m, html);
		let loadingP = document.createElement("span");

		const buttons = document.createElement("div");
		buttons.classList.add("flexltr");

		const retryB = document.createElement("button");
		retryB.textContent = I18n.message.retry();

		const dont = document.createElement("button");
		dont.textContent = I18n.message.delete();
		dont.onclick = (_) => {
			this.fakeMessages.delete(m);
			html.remove();
			for (const {url} of m.attachments) {
				URL.revokeObjectURL(url);
			}
		};
		dont.style.marginLeft = "4px";
		buttons.append(retryB, dont);

		if (this === this.localuser.channelfocus) {
			if (!this.infinitefocus) {
				await this.tryfocusinfinate();
			}
			await this.infinite.addedBottom();
			this.focus(m.id, false);
		}

		return {
			progress: (total: number, sofar: number) => {
				if (total < 20000 || sofar === total) {
					loadingP.remove();
					return;
				}
				html.append(loadingP);
				loadingP.textContent = File.filesizehuman(sofar) + " / " + File.filesizehuman(total);
			},
			failed: (retry: () => void) => {
				m.deleteEvent();
				makeRecent();
				loadingP.remove();
				html.append(buttons);
				retryB.onclick = () => {
					retry();
					html.classList.remove("erroredMessage");
					buttons.remove();
				};
				html.classList.add("erroredMessage");
			},
			void: () => {
				m.deleteEvent();
				html.remove();
			},
		};
	}
	async uploadFile(files: globalThis.File[], ids?: string[]) {
		const slots = await fetchRetryOnce(this.info.api + "/channels/" + this.id + "/attachments", {
			headers: this.headers,
			body: JSON.stringify({
				files: files.map((file, index) => {
					return {
						file_size: file.size,
						filename: file.name,
						id: ids?.[index] ?? index + "",
					};
				}),
			}),
			method: "POST",
		});
		if (!slots.ok) throw new Error("attachment upload failed: " + slots.status);
		const urls = (await slots.json()) as {
			attachments: {
				id: string;
				upload_url: string;
				upload_filename: string;
				original_content_type?: string;
			}[];
		};
		// Resolve only once every byte stream landed: a caller that submits while the PUTs are
		// still in flight loses the upload (the server pairs by id at submit time, once).
		await Promise.all(
			urls.attachments.map(async ({upload_url}, index) => {
				const res = await fetchRetryOnce(upload_url, {
					body: files[index],
					method: "PUT",
				});
				if (!res.ok) throw new Error("attachment upload failed: " + res.status);
				return res;
			}),
		);
		return urls.attachments;
	}
	nonces = new Set<string>();
	lastSentMessage?: Message;
	canMessageRightNow() {
		if (this.guild.member) {
			const member = this.guild.member;
			if (member.commuicationDisabledLeft()) return false;
		}
		const t = this.lastSentMessage?.getTimeStamp();
		if (!t) return true;
		if (
			this.hasPermission("BYPASS_SLOWMODE") ||
			this.hasPermission("MANAGE_MESSAGES") ||
			this.hasPermission("MANAGE_CHANNELS")
		)
			return true;

		if (this.rate_limit_per_user === 0) return true;

		let canMessage = t + this.rate_limit_per_user * 1000;
		return canMessage <= Date.now();
	}
	/** Whether the channel is behind the NSFW gate (its panel stands in for the messages). */
	nsfwGated() {
		if (!this.nsfw) return false;
		//@ts-expect-error another hack
		const allowed = Boolean(this.localuser.user.nsfw_allowed);
		const action = getSensitiveContentSync().nsfw;
		if (action === "block") return true;
		if (action === "show") return !allowed;
		return !this.perminfo.nsfwOk || !allowed;
	}
	/** Locks or unlocks the composer for whether the user may send here now. Only the open
	 * channel's composer is on the page; a forum has none, and the NSFW gate keeps it locked. */
	refreshComposerLock() {
		if (this !== this.localuser.channelfocus || this.isForum() || this.nsfwGated()) return;
		const canMessage = this.canMessage;
		try {
			(document.getElementById("typebox") as HTMLDivElement).contentEditable = canMessage
				? "plaintext-only"
				: "false";
		} catch {
			(document.getElementById("typebox") as HTMLDivElement).contentEditable = canMessage
				? "true"
				: "false";
		}
		(document.getElementById("upload") as HTMLElement).style.visibility = canMessage
			? "visible"
			: "hidden";
		(document.getElementById("gifTB") as HTMLElement).style.display = canMessage
			? "block"
			: "none";
		(document.getElementById("stickerTB") as HTMLElement).style.display = canMessage
			? "block"
			: "none";
		(document.getElementById("emojiTB") as HTMLElement).style.display = canMessage
			? "block"
			: "none";
		(document.getElementById("mobileSend") as HTMLElement).style.display = canMessage
			? "block"
			: "none";
	}
	async slowmode(bad = false) {
		// The composer on the page belongs to the open channel; any other channel leaves it alone.
		if (this !== this.localuser.channelfocus) return;
		const realbox = document.getElementById("realbox") as HTMLDivElement;
		Array.from(realbox.getElementsByClassName("slowmodeTimer")).forEach((_) => _.remove());
		if (this.guild.member) {
			const member = this.guild.member;
			const left = member.commuicationDisabledLeft();
			if (left) {
				const span = document.createElement("span");
				span.classList.add("slowmodeTimer");
				realbox.append(span);
				const canMessage = +(member.communication_disabled_until as Date);
				const tick = () => {
					const timeTill = canMessage - Date.now();
					if (timeTill <= 0 || !document.contains(span)) {
						if (document.contains(span)) span.remove();
						clearInterval(int);
						if (timeTill <= 0) this.refreshComposerLock();
						return;
					}
					span.textContent = I18n.channel.TimeOutCool(formatTime(timeTill));
				};
				tick();
				const int = setInterval(tick, 1000);
			}
		}
		function formatTime(timeTill: number) {
			let seconds = Math.round(timeTill / 1000);
			let minutes = Math.floor(seconds / 60);
			seconds -= minutes * 60;
			let hours = Math.floor(minutes / 60);
			minutes -= hours * 60;
			let build = "";
			build = seconds + "";
			if (minutes || hours) {
				build = minutes + ":" + build.padStart(2, "0");
			}
			if (hours) {
				build = hours + ":" + build.padStart(5, "0");
			}
			return build;
		}
		if (!this.rate_limit_per_user) return;
		if (
			this.hasPermission("BYPASS_SLOWMODE") ||
			this.hasPermission("MANAGE_MESSAGES") ||
			this.hasPermission("MANAGE_CHANNELS")
		)
			return;
		let m: Message | undefined = this.lastSentMessage;
		if (!m) {
			// The user's newest loaded message: back from the newest one.
			let older = this.lastmessage;
			while (older && older.author.id !== this.localuser.user.id) {
				older = this.messages.get(this.idToPrev.get(older.id) as string);
			}
			m = this.lastSentMessage = older;
		}

		if (!m && bad) {
			// Refused for slowmode with none loaded: ask for the user's newest in this channel.
			const q = new URLSearchParams([
				["author_id", this.localuser.user.id],
				["limit", "1"],
			]);
			const res = await fetch(this.info.api + "/channels/" + this.id + "/messages/search/?" + q, {
				headers: this.headers,
			});
			// Search answers Discord's shape: each hit is a list (the message, with context).
			const json = res.ok ? ((await res.json()) as {messages?: messagejson[][]}) : undefined;
			const message = json?.messages?.[0]?.[0];
			if (message) m = this.lastSentMessage = new Message(message, this, true);
			// The user may have opened another channel meanwhile.
			if (this !== this.localuser.channelfocus) return;
		}
		if (!m) return;
		const t = m.getTimeStamp();
		let canMessage = t + this.rate_limit_per_user * 1000;

		if (canMessage <= Date.now()) {
			realbox.classList.remove("cantSendMessage");
			return;
		} else {
			realbox.classList.add("cantSendMessage");
			const span = document.createElement("span");
			span.classList.add("slowmodeTimer");
			realbox.append(span);
			const tick = () => {
				const timeTill = canMessage - Date.now();
				if (timeTill <= 0 || !document.contains(span)) {
					if (document.contains(span)) span.remove();
					clearInterval(int);
					return;
				}
				span.textContent = I18n.channel.SlowmodeCool(formatTime(timeTill));
			};
			tick();
			const int = setInterval(tick, 1000);
		}
	}
	/** Why the server refused the last send, shown above the composer until the next send. */
	static showSendError(text: string) {
		const realbox = document.getElementById("realbox");
		if (!realbox) return;
		Channel.clearSendError();
		const notice = document.createElement("div");
		notice.classList.add("sendError");
		notice.setAttribute("role", "alert");
		notice.textContent = text;
		realbox.prepend(notice);
	}
	static clearSendError() {
		document.querySelectorAll("#realbox .sendError").forEach((el) => el.remove());
	}
	async sendMessage(
		content: string,
		{
			attachments = [],
			replyingto = null,
			embeds = [],
			sticker_ids = [],
			nonce = undefined,
			poll = undefined,
		}: {
			attachments?: Blob[];
			embeds?: embedjson[];
			replyingto?: Message | null;
			sticker_ids?: string[];
			nonce?: string;
			poll?: creatPollJSON;
		},
		onRes: (_e: "Ok" | "NotOk") => boolean | void = () => {},
	) {
		let ressy = (_e: "Ok" | "NotOk") => {};
		let resOnce = false;
		if (
			content.trim() === "" &&
			attachments.length === 0 &&
			embeds.length == 0 &&
			sticker_ids.length === 0 &&
			!poll
		) {
			return;
		}
		Channel.clearSendError();
		// Typed-mention resolution is best-effort enrichment: a half-loaded guild or a
		// test-fixture shell may not carry a real member Set, and a send must never
		// break on it. The `@` check keeps memberless sends allocation-free.
		if (content.includes("@")) {
			const memberCandidates =
				this.guild.members instanceof Set
					? [...this.guild.members].map((m) => ({
							id: m.id,
							names: m.nick ? [m.user.username, m.nick] : [m.user.username],
						}))
					: [];
			content = resolveTypedMentions(
				content,
				this.guild.id === "@me"
					? ((this as {users?: User[]}).users ?? []).map((u) => ({
							id: u.id,
							names: u.nickname ? [u.username, u.nickname] : [u.username],
						}))
					: memberCandidates,
			);
		}
		let replyjson: any;
		if (replyingto) {
			replyjson = {
				// A DM reply names no guild ("@me" is the client's pseudo-guild, not a wire id).
				guild_id: wireGuildId(replyingto.guild),
				channel_id: replyingto.channel.id,
				message_id: replyingto.id,
			};
		}

		let prom: Promise<void>;
		let res: XMLHttpRequest;
		let funcs:
			| undefined
			| {
					progress: (total: number, sofar: number) => void;
					failed: (restart: () => void) => void;
					void: () => void;
			  };
		const progress = (e: ProgressEvent<EventTarget>) => {
			funcs?.progress(e.total, e.loaded);
		};

		const resend = () => {
			res.open("POST", this.info.api + "/channels/" + this.id + "/messages");
			res.setRequestHeader("Authorization", this.headers.Authorization);
			if (ctype) {
				res.setRequestHeader("Content-type", ctype);
			}
			res.send(rbody);
		};
		const fail = () => {
			funcs?.failed(resend);
		};

		let rateLimitRetried = false;
		const promiseHandler = (resolve: () => void) => {
			res.responseType = "json";
			res.onload = () => {
				if (res.status === 429 && !rateLimitRetried) {
					const limit = res.response as {code?: number; retry_after?: unknown} | null;
					// Slowmode (20016) has its own countdown and no retry; any other 429 waits out
					// the window and re-sends once, the bubble staying in flight meanwhile.
					if (limit?.code !== 20016) {
						rateLimitRetried = true;
						setTimeout(() => {
							try {
								resend();
							} catch {
								fail();
							}
						}, retryAfterMsFromBody(limit));
						return;
					}
				}
				if (res.status !== 200) {
					// Refused: the bubble goes and the composer gets the text back; when the caller
					// could not put it back, the bubble stays as failed so the message is not lost.
					let putBack: boolean | void = false;
					try {
						putBack = onRes("NotOk");
					} catch (e) {
						// A restore that threw put nothing back: keep the message as failed.
						console.error(e);
					}
					if (putBack === false) fail();
					else ressy("NotOk");
					const body = res.response as {code?: number; message?: unknown; errors?: unknown} | null;
					// Only over this channel's composer: a reply that lands after the user moved on
					// would otherwise sit under another channel's box.
					if (this.localuser?.channelfocus === this) {
						if (body?.code === 20016) {
							this.slowmode(true);
						} else {
							Channel.showSendError(sendErrorText(body));
						}
					}
				} else {
					ressy("Ok");
					onRes("Ok");
					if (!resOnce && res?.status) {
						resOnce = true;
					}
				}
				resolve();
			};
		};

		let rbody: string | FormData;
		let ctype: string | undefined;
		const maybeUpdate = () => {
			if ("updatePosition" in this && this.updatePosition instanceof Function) {
				this.updatePosition(Date.now());
			}
		};
		maybeUpdate();
		ressy = async (e) => {
			if (e == "NotOk") {
				funcs?.void();
				return;
			}
		};
		if (attachments.length === 0) {
			const body = {
				content,
				nonce: nonce || (await createMachloketNonce()),
				message_reference: undefined,
				sticker_ids,
				embeds,
				poll,
			};
			if (replyjson) {
				body.message_reference = replyjson;
			}
			res = new XMLHttpRequest();
			res.responseType = "json";
			res.upload.onprogress = progress;
			res.onerror = fail;
			prom = new Promise<void>(promiseHandler);
			res.open("POST", this.info.api + "/channels/" + this.id + "/messages");
			res.setRequestHeader("Content-type", (ctype = this.headers["Content-type"]));
			res.setRequestHeader("Authorization", this.headers.Authorization);
			funcs = await this.makeFakeMessage(
				content,
				[],
				body.message_reference,
				sticker_ids,
				body.nonce,
				embeds,
			);
			await new Promise((resolve) => requestAnimationFrame(resolve));

			try {
				res.send((rbody = JSON.stringify(body)));
			} catch {
				fail();
			}
			/*
			res = fetch(this.info.api + "/channels/" + this.id + "/messages", {
				method: "POST",
				headers: this.headers,
				body: JSON.stringify(body),
			});
			*/
		} else {
			const formData = new FormData();
			const body = {
				content,
				nonce: nonce || (await createMachloketNonce()),
				message_reference: undefined,
				sticker_ids,
				embeds,
				poll,
			};
			if (replyjson) {
				body.message_reference = replyjson;
			}
			formData.append("payload_json", JSON.stringify(body));
			for (const i in attachments) {
				formData.append("files[" + i + "]", attachments[i]);
			}

			res = new XMLHttpRequest();
			res.responseType = "json";
			res.upload.onprogress = progress;
			res.onerror = fail;
			prom = new Promise<void>(promiseHandler);
			res.open("POST", this.info.api + "/channels/" + this.id + "/messages", true);

			res.setRequestHeader("Authorization", this.headers.Authorization);

			funcs = await this.makeFakeMessage(
				content,
				attachments.map((_) => ({
					id: "string",
					filename: "",
					content_type: _.type,
					size: _.size,
					url: URL.createObjectURL(_),
				})),
				body.message_reference,
				sticker_ids,
				body.nonce,
			);
			await new Promise((resolve) => requestAnimationFrame(resolve));
			try {
				res.send((rbody = formData));
			} catch {
				fail();
			}
			/*
			res = fetch(this.info.api + "/channels/" + this.id + "/messages", {
				method: "POST",
				body: formData,
				headers: {Authorization: this.headers.Authorization},
			});
			*/
		}

		return prom;
	}
	unreads() {
		if (!this.hasunreads) {
			if (this.myhtml) {
				this.myhtml.classList.remove("cunread", "mentioned");
			}
		} else {
			if (this.myhtml) {
				this.myhtml.classList.add("cunread");
			}
			if (this.mentions !== 0) {
				this.myhtml?.classList.add("mentioned");
			}
		}
	}
	async goToBottom() {
		if (this.lastmessageid) await this.focus(this.lastmessageid, false);
	}
	async messageCreate(messagep: messageCreateJson): Promise<void> {
		if (this.totalMessageSent !== undefined) this.totalMessageSent++;
		if (this.messageCount !== undefined) this.messageCount++;
		if (!this.hasPermission("VIEW_CHANNEL")) {
			return;
		}
		if (this.messages.get(messagep.d.id)) {
			console.error("Duped message?");
			return;
		}
		this.nonces.add(messagep.d.nonce);
		setTimeout(
			() => {
				this.nonces.delete(messagep.d.nonce);
			},
			1000 * 60 * 5,
		);

		if (!this.lastmessageid) {
			this.topid = messagep.d.id;
		}
		const messagez = new Message(messagep.d, this);
		Member.resolveMember(messagez.author, this.guild).then((_) => {
			this.typingmap.delete(_ as Member);
			this.rendertyping();
		});
		this.lastmessage = messagez;
		if (this.lastmessageid && this.lastmessageid !== messagez.id) {
			this.idToNext.set(this.lastmessageid, messagez.id);
			this.idToPrev.set(messagez.id, this.lastmessageid);
		} else {
			console.error("something bad happened");
		}
		if (
			(messagez.mentionsuser(this.localuser.user) || this.guild.id === "@me") &&
			messagez.author !== this.localuser.user
		) {
			this.mentions++;
		}
		this.setLastMessageId(messagez.id);

		if (this.isChatViewActive() && this.infinite.atBottom()) {
			this.lastreadmessageid = messagez.id;
		}

		this.unreads();
		this.guild.unreads();
		if (this === this.localuser.channelfocus) {
			if (!this.infinitefocus) {
				await this.tryfocusinfinate();
			}
			await this.infinite.addedBottom();
		}

		if (messagez.author === this.localuser.user) {
			this.lastSentMessage = messagez;
			this.lastreadmessageid = messagez.id;
			this.slowmode();
			this.mentions = 0;
			this.unreads();
			this.guild.unreads();
			if (this == this.localuser.channelfocus) {
				setTimeout(() => this.goToBottom());
			}
		}
		this.fireEvents();

		if (messagez.author === this.localuser.user) {
			return;
		}
		if (this.localuser.lookingguild?.prevchannel === this && document.hasFocus()) {
			return;
		}

		this.notify(messagez);
	}
	notititle(message: Message): string {
		return message.author.username + " > " + this.guild.properties.name + " > " + this.name;
	}
	/** The notification gates: channel/guild mute, DND, the per-channel setting, blocked author. */
	notiGates(message: Message): boolean {
		if (this.muted) return false;
		if (this.localuser.status === "dnd") return false;
		if (this.guild.muted) return false;
		if (this.trueNotiValue === "none") return false;
		if (this.trueNotiValue === "mentions" && !message.mentionsuser(this.localuser.user)) {
			return false;
		}
		return message.author.relationshipType != 2;
	}
	/** One in-flight browser prompt however many messages burst in while unset. */
	private static permissionPrompt?: Promise<NotificationPermission>;
	private askPermission(): Promise<NotificationPermission> {
		Channel.permissionPrompt ??= Notification.requestPermission()
			.then((permission) => {
				// A decision (granted or denied) is in: the enable bar has nothing left to ask. "default"
				// is no decision: a gesture-gated browser showed nothing, so the bar stays for its tap.
				if (permission !== "default") hideNotifyBanner();
				return permission;
			})
			.finally(() => {
				Channel.permissionPrompt = undefined;
			});
		return Channel.permissionPrompt;
	}
	notify(message: Message) {
		if (!this.notiGates(message)) return;

		try {
			void NotificationSoundManager.playFromPreferences();
		} catch (e) {
			console.error("Failed to play notification sound:", e);
		}
		// iOS Safari outside an installed PWA has no Notification at all.
		if (!("Notification" in window)) return;
		if (Notification.permission === "granted") {
			NotificationHandler.sendMessageNotification(message).catch((e) =>
				console.error("Couldn't show the notification:", e),
			);
		} else if (Notification.permission !== "denied") {
			// Bursts share one prompt; a dismissed one doesn't re-ask for THIS message
			// (or replay the sound) — a later message may ask afresh.
			void this.askPermission().then((permission) => {
				if (permission !== "granted") return;
				// The prompt can outlive the gate state (muted mid-prompt): re-check.
				if (!this.notiGates(message)) return;
				return NotificationHandler.sendMessageNotification(message);
			}).catch((e) => console.error("Couldn't show the notification:", e));
		}
	}
	voiceMode: "VoiceOnly" | "ChatAndVoice" = "VoiceOnly";
	async addRoleToPerms(role: Role | User) {
		await fetch(this.info.api + "/channels/" + this.id + "/permissions/" + role.id, {
			method: "PUT",
			headers: this.headers,
			body: JSON.stringify({
				allow: "0",
				deny: "0",
				id: role.id,
				type: role instanceof User ? 1 : 0,
			}),
		});
		const perm = new Permissions("0", "0");
		this.permission_overwrites.set(role.id, perm);
		this.permission_overwritesar.push([role.id, perm]);
	}
	async updateRolePermissions(id: string, perms: Permissions): Promise<boolean> {
		// The editor keeps mutating `perms` (another role opened mid-save); keep what was sent.
		const {allow, deny} = perms;
		const res = await fetch(this.info.api + "/channels/" + this.id + "/permissions/" + id, {
			method: "PUT",
			headers: this.headers,
			body: JSON.stringify({
				allow: allow.toString(),
				deny: deny.toString(),
				id,
				type: this.localuser.userMap.get(id) ? 1 : 0,
			}),
		}).catch(() => undefined);
		// Refused, e.g. bits one doesn't hold (403 50013): the overwrite stays as it was.
		if (!res?.ok) {
			new Dialog(I18n.requestFailed(res ? "HTTP " + res.status : "offline")).show();
			return false;
		}
		const permission = this.permission_overwrites.get(id);
		if (permission) {
			permission.allow = allow;
			permission.deny = deny;
		} else {
			//this.permission_overwrites.set(id,perms);
		}
		return true;
	}
}
Channel.setupcontextmenu();
export {Channel};
