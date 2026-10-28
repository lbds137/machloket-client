import {Channel} from "./channel.js";
import {Localuser} from "./localuser.js";
import {Contextmenu} from "./contextmenu.js";
import {Role, RoleList} from "./role.js";
import {Member} from "./member.js";
import {Dialog, FormError, Options, Settings} from "./settings.js";
import {Permissions} from "./permissions.js";
import {SnowFlake} from "./snowflake.js";
import {
	channeljson,
	guildjson,
	memberjson,
	invitejson,
	rolesjson,
	emojipjson,
	extendedProperties,
	banObj,
	templateSkim,
	mute_config,
	GuildOverrides,
	commandJson,
	applicationJson,
	presencejson,
	welcomeScreen,
} from "./jsontypes.js";
import {User} from "./user.js";
import {I18n} from "./i18n.js";
import {Emoji} from "./emoji.js";
import {webhookMenu} from "./webhooks.js";
import {createImg} from "./utils/utils.js";
import {Sticker} from "./sticker.js";
import {ProgessiveDecodeJSON} from "./utils/progessiveLoad.js";
import {MarkDown} from "./markdown.js";
import {Command} from "./interactions/commands.js";
import {commandAllowedFor} from "./commandPermissions.js";
import {Hover} from "./hover.js";
import {ReportMenu} from "./reporting/report.js";
import {getDeveloperSettings} from "./utils/storage/devSettings.js";
import {CDNParams} from "./utils/cdnParams.js";
import {assignableKey} from "./utils/assignableKey.js";
import {fetchRetryOnce} from "./utils/rateLimit.js";
import {showRefusal} from "./utils/showRefusal.js";
import {holdsInviteLink, showNewInvite} from "./utils/inviteLink.js";
export async function makeInviteMenu(inviteMenu: Options, guild: Guild, url: string) {
	const invDiv = document.createElement("div");
	invDiv.classList.add("inviteGrid");
	const bansp = ProgessiveDecodeJSON<invitejson[]>(url, {
		headers: guild.headers,
	});
	const createInviteHTML = (invite: invitejson) => {
		const div = document.createElement("div");
		div.classList.add("inviteCard");

		const code = document.createElement("span");
		code.classList.add("inviteCode");
		code.textContent = invite.code;

		const used = document.createElement("span");
		used.classList.add("inviteUsed");
		const maxTxt = invite.max_uses ? "/" + invite.max_uses : "";
		used.textContent = invite.uses + maxTxt;

		// Discord's list shape has a `channel` object and no `channel_id`.
		const channelId = invite.channel?.id ?? invite.channel_id;
		const channel = guild.channels.find((_) => _.id == channelId);
		if (channel) {
			const ch = document.createElement("span");
			ch.classList.add("inviteChannel");
			ch.textContent = "#" + channel.name;
			div.append(ch);
		}

		div.append(code, used);

		div.onclick = () => {
			const opt = inviteMenu.addSubOptions(invite.code);

			opt.addMDText(
				new MarkDown(
					"https://sbar.fyi" +
						"/i/" +
						invite.code +
						"?" +
						new URLSearchParams([["instance", guild.info.wellknown]]),
					undefined,
				),
			);

			opt.addText(I18n.invite.used(invite.uses + (invite.max_uses ? "/" + invite.max_uses : "")));
			if (invite.max_uses !== 0) opt.addText(I18n.invite.maxUses(invite.max_uses + ""));

			if (channel) {
				opt.addText(I18n.invite.forChannel(channel.name));
			}

			opt.addText(
				I18n.invite.createdAt(new Date(invite.created_at).toLocaleDateString(I18n.locale)),
			);

			let expires = I18n.invite.never();
			if (invite.expires_at) {
				expires = new Date(invite.expires_at).toLocaleDateString(I18n.locale);
			}
			opt.addText(I18n.invite.expires(expires));

			// A system or vanity invite has no inviter (the server leaves the field out).
			if (invite.inviter) {
				opt.addText(I18n.webhooks.createdBy());
				opt.addHTMLArea(new User(invite.inviter, guild.localuser).createWidget(guild));
			}

			opt.addButtonInput("", I18n.delete(), async () => {
				const res = await fetch(guild.info.api + "/invites/" + invite.code, {
					method: "DELETE",
					headers: guild.headers,
				}).catch(() => undefined);
				if (res?.ok) {
					invsArr = invsArr.filter((_) => _ !== invite);
					inviteMenu.returnFromSub();
					renderInvites(allShown);
				} else {
					await showRefusal(res);
				}
			});
		};

		return div;
	};
	let invsArr: invitejson[] = [];
	let allShown = false;
	const showAllBtn = document.createElement("button");
	showAllBtn.classList.add("sessionShowAll");

	async function loadArr() {
		while (!(await bansp).done) {
			const inv = await (await (await bansp).getNext()).getWhole();
			invsArr.push(inv);
		}
		invsArr.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
		renderInvites(false);
	}

	function renderInvites(all: boolean) {
		allShown = all;
		invDiv.innerHTML = "";
		const toShow = all ? invsArr : invsArr.slice(0, 10);
		for (const inv of toShow) {
			invDiv.append(createInviteHTML(inv));
		}
		invDiv.style.display = invsArr.length ? "" : "none";
		showAllBtn.textContent = all ? "" : I18n.settings.showAll(" ( " + invsArr.length + " )");
		showAllBtn.style.display = !all && invsArr.length > 10 ? "" : "none";
	}

	loadArr();
	inviteMenu.addHTMLArea(invDiv);
	showAllBtn.onclick = () => renderInvites(true);
	inviteMenu.addHTMLArea(showAllBtn);
}
/** One scope's command index: the fetch (shared while in flight) and, once it succeeded, its
 * commands for synchronous readers. */
type CommandIndexEntry = {
	promise: Promise<{apps: applicationJson[]; commands: Command[]}>;
	settled?: Command[];
	appOwners?: Map<string, string>;
};
class Guild extends SnowFlake {
	owner!: Localuser;
	headers!: Localuser["headers"];
	channels!: Channel[];
	properties!: guildjson["properties"];
	member_count!: number;
	roles!: Role[];
	roleids!: Map<string, Role>;
	prevchannel: Channel | undefined;
	banner!: string;
	message_notifications!: number;
	headchannels!: Channel[];
	position!: number;
	parent_id!: string;
	member!: Member;
	/** Settles once `member` is resolved (or the resolve failed): deep-link boots await it
	 * before resolving the URL, so permission checks see the viewer's member. The shell
	 * constructor (-1) keeps it resolved — nothing to wait for. */
	memberReady: Promise<void> = Promise.resolve();
	html!: HTMLElement;
	emojis: emojipjson[] = [];
	large!: boolean;
	stickers!: Sticker[];
	members = new Set<Member>();
	static contextmenu = new Contextmenu<Guild, undefined>("guild menu");
	static setupcontextmenu() {
		Guild.contextmenu.addButton(
			() => I18n.guild.markRead(),
			function (this: Guild) {
				this.markAsRead();
			},
		);

		Guild.contextmenu.addSeperator();

		Guild.contextmenu.addButton(
			() => I18n.guild.makeInvite(),
			function (this: Guild) {
				const d = new Dialog("");
				this.makeInviteMenu(d.options);
				d.show();
			},
			{
				enabled: function () {
					return this.member.hasPermission("CREATE_INSTANT_INVITE");
				},
				color: "blue",
			},
		);

		Guild.contextmenu.addButton(
			() => I18n.guild.notifications(),
			function (this: Guild) {
				this.setnotifcation();
			},
		);
		Guild.contextmenu.addButton(
			() => I18n.guild.mute(),
			function (this: Guild) {
				this.muteGuild();
			},
			{
				visible: function () {
					return !this.muted;
				},
			},
		);
		Guild.contextmenu.addButton(
			() => I18n.guild.unmute(),
			function (this: Guild) {
				this.unmuteGuild();
			},
			{
				visible: function () {
					return this.muted;
				},
			},
		);
		Guild.contextmenu.addSeperator();
		this.contextmenu.addButton(
			() => I18n.user.editServerProfile(),
			function () {
				this.member.showEditProfile();
			},
		);
		Guild.contextmenu.addSeperator();

		Guild.contextmenu.addButton(
			() => I18n.guild.leave(),
			function (this: Guild) {
				this.confirmleave();
			},
			{
				visible: function (_) {
					return this.properties.owner_id !== this.member.user.id;
				},
				color: "red",
			},
		);

		Guild.contextmenu.addButton(
			() => I18n.guild.delete(),
			function (this: Guild) {
				this.confirmDelete();
			},
			{
				visible: function (_) {
					return this.properties.owner_id === this.member.user.id;
				},
				color: "red",
				icon: {
					css: "svg-delete",
				},
			},
		);

		Guild.contextmenu.addButton(
			() => I18n.guild.settings(),
			function (this: Guild) {
				this.generateSettings();
			},
			{
				visible: function () {
					return (
						this.member.hasPermission("MANAGE_GUILD") ||
						this.member.hasPermission("MANAGE_WEBHOOKS") ||
						this.member.hasPermission("BAN_MEMBERS") ||
						this.member.hasPermission("MANAGE_GUILD_EXPRESSIONS") ||
						this.member.hasPermission("MANAGE_ROLES")
					);
				},
				icon: {
					css: "svg-settings",
				},
			},
		);

		Guild.contextmenu.addButton(
			() => I18n.guild.admins(),
			function (this: Guild) {
				this.findAdmin();
			},
			{
				icon: {
					css: "svg-shield",
				},
			},
		);
		Guild.contextmenu.addSeperator();
		Guild.contextmenu.addButton(
			() => I18n.channel.createChannel(),
			function () {
				this.createchannels();
			},
			{
				visible: function () {
					return this.member.hasPermission("MANAGE_CHANNELS");
				},
			},
		);
		Guild.contextmenu.addButton(
			() => I18n.channel.createCatagory(),
			function () {
				this.createcategory();
			},
			{
				visible: function () {
					return this.member.hasPermission("MANAGE_CHANNELS");
				},
			},
		);

		Guild.contextmenu.addSeperator();
		Guild.contextmenu.addButton(
			() => I18n.guild.copyId(),
			function (this: Guild) {
				navigator.clipboard.writeText(this.id);
			},
		);
		Guild.contextmenu.addButton(
			() => I18n.guild.report(),
			async function () {
				const menu = await ReportMenu.makeReport("guild", this.localuser, {guild: this});
				menu?.spawnMenu();
			},
			{
				visible: function () {
					const settings = getDeveloperSettings();
					return this.properties.owner_id !== this.localuser.user.id && settings.reportSystem;
				},
				color: "red",
			},
		);
		Guild.contextmenu.addButton(
			() => I18n.guild.copyInfo(),
			function (this: Guild) {
				navigator.clipboard.writeText(`${this.properties.name} (${this.id})`);
			},
		);
	}
	get muted() {
		return !!this.mute_config && new Date(this.mute_config.end_time).getTime() > Date.now();
	}
	resolveMember(user: User) {
		return Member.resolveMember(user, this);
	}
	getChannel(id: string) {
		return this.channels.find((_) => _.id === id);
	}
	recalcPrivate() {
		if (this !== this.localuser.lookingguild) return;
		this.localuser.channelfocus?.refreshComposerLock();
		this.localuser.channelfocus?.slowmode();
	}
	async findAdmin() {
		const menu = new Dialog(I18n.guild.admins());
		menu.options.addText(I18n.loading());
		menu.show();
		const roles = new Set(
			Object.entries(
				(await (
					await fetch(this.info.api + `/guilds/${this.id}/roles/member-counts/`, {
						headers: this.headers,
					})
				).json()) as {[key: string]: number},
			)
				.map(([id, count]) => {
					return [this.roleids.get(id), count] as [Role, number];
				})
				//Just in case, this should never fire
				.filter((_) => _[0] !== undefined)
				//Filter out those who have too many users
				.filter((_) => _[1] > 1000)
				.map((_) => _[0]),
		);
		const everyone = this.roleids.get(this.id);
		if (everyone) roles.add(everyone);
		menu.options.removeAll();
		let owner = true;
		let perms = [
			"ADMINISTRATOR",
			"BAN_MEMBERS",
			"KICK_MEMBERS",
			"MANAGE_GUILD",
			"MANAGE_CHANNELS",
			"MODERATE_MEMBERS",
			"MANAGE_ROLES",
			"MANAGE_MESSAGES",
			"MANAGE_NICKNAMES",
			"MANAGE_WEBHOOKS",
			"MANAGE_EVENTS",
			"MANAGE_THREADS",
		].filter((_) => {
			for (const role of roles) {
				if (role.permissions.hasPermission(_, false)) {
					return false;
				}
			}
			return true;
		});

		menu.options.addButtonInput("", I18n.guild.adminMenu.changePerms(), () => {
			const d = new Dialog("", {noSubmit: false});
			const opt = d.options;
			opt
				.addCheckboxInput(
					I18n.guild.adminMenu.owner(),
					(b) => {
						owner = b;
						d.hide();
						queueMicrotask(() => loadResults());
					},
					{
						initState: owner,
					},
				)
				.watchForChange(() => opt.changed());
			for (const perm of Permissions.info().filter((_) => {
				for (const role of roles) {
					if (role.permissions.hasPermission(_.name, false)) {
						return false;
					}
				}
				return true;
			})) {
				opt.addHR();
				opt
					.addCheckboxInput(
						perm.readableName,
						(b) => {
							if (b) {
								perms.push(perm.name);
							} else {
								perms = perms.filter((_) => _ !== perm.name);
							}
						},
						{
							initState: perms.includes(perm.name),
						},
					)
					.watchForChange(() => opt.changed());
				opt.addText(perm.description);
			}
			d.show().style.width = "80%";
		});

		const retDiv = document.createElement("div");
		menu.options.addHTMLArea(retDiv);
		const loadResults = async () => {
			retDiv.textContent = I18n.guild.adminMenu.finding();
			const results = new Set(
				(
					await Promise.all(
						this.roles
							.filter((_) => {
								for (const perm of perms) {
									if (_.permissions.hasPermission(perm, false)) {
										return true;
									}
								}
								return false;
							})
							.map(async (_) => {
								return (
									await fetch(`${this.info.api}/guilds/${this.id}/roles/${_.id}/member-ids`, {
										headers: this.headers,
									})
								).json() as Promise<string[]>;
							}),
					)
				).flat(),
			);
			if (owner) {
				results.add(this.properties.owner_id);
			}
			const members = (
				await Promise.all(
					[...results].map(async (_) => {
						const json = await this.localuser.resolvemember(_, this.id);
						return json ? Member.new(json, this) : undefined;
					}),
				)
			).filter((_) => _ !== undefined);
			members.sort((a, b) => {
				return a.name < b.name ? 1 : -1;
			});
			retDiv.innerHTML = "";
			retDiv.append(
				...members.map((memb) => {
					const div = document.createElement("div");
					div.classList.add("flexltr", "adminList");
					const name = document.createElement("b");
					name.textContent = memb.name;
					const nameBox = document.createElement("div");
					nameBox.classList.add("flexttb");

					const roles = document.createElement("div");
					roles.classList.add("flexltr");
					roles.append(
						...perms
							.filter((_) => memb.hasPermission(_, false))
							.map((perm) => {
								const span = document.createElement("span");
								//@ts-ignore
								span.textContent = I18n.permissions.readableNames[perm]();
								return span;
							}),
					);
					if (owner && memb.id === this.properties.owner_id) {
						const span = document.createElement("span");
						span.textContent = I18n.guild.adminMenu.ownName();
						roles.append(span);
					}

					nameBox.append(name, roles);

					const pfp = memb.user.buildpfp(memb, div);

					div.append(pfp, nameBox);

					memb.user.bind(div, this, undefined);
					return div;
				}),
			);
			console.log(members);
		};
		loadResults();
	}
	async searchMembers(limit: number, query: string): Promise<Member[]> {
		if (this.id !== "@me") {
			return new Promise<Member[]>((res) => {
				const nonce = Math.floor(Math.random() * 10 ** 8) + "";
				const ws = this.localuser.ws;
				// Disconnected: nothing to ask, so no match rather than a search that never answers.
				if (!ws) {
					res([]);
					return;
				}
				ws.send(
					JSON.stringify({
						op: 8,
						d: {
							guild_id: [this.id],
							query,
							limit,
							presences: true,
							nonce,
						},
					}),
				);
				this.localuser.searchMap.set(
					nonce,
					async (e: {
						chunk_index: number;
						chunk_count: number;
						nonce: string;
						not_found?: string[];
						members?: memberjson[];
						presences: presencejson[];
					}) => {
						console.log(e);
						if (e.members && e.members[0]) {
							if (e.members[0].user) {
								res(
									(await Promise.all(e.members.map(async (_) => await Member.new(_, this)))).filter(
										(_) => _ !== undefined,
									),
								);
							} else {
								const prom1: Promise<User>[] = [];
								for (const thing of e.members) {
									prom1.push(this.localuser.getUser(thing.id));
								}
								await Promise.all(prom1);
								res(
									(await Promise.all(e.members.map(async (_) => await Member.new(_, this)))).filter(
										(_) => _ !== undefined,
									),
								);
							}
						} else {
							// No match answers with an empty chunk: the search is over.
							res([]);
						}
						return [];
					},
				);
			});
		}
		return [];
	}
	async showWelcome() {
		const res = await fetch(this.info.api + "/guilds/" + this.id + "/welcome-screen", {
			headers: this.headers,
		}).catch(() => undefined);
		if (!res?.ok) return showRefusal(res);
		this.welcomeScreen = (await res.json().catch(() => null)) ?? undefined;
		if (!this.welcomeScreen?.enabled) return;
		const dio = new Dialog(I18n.onboarding.title(this.properties.name));
		const opt = dio.options;
		let i = 0;
		for (const cha of this.welcomeScreen.welcome_channels) {
			const channel = this.getChannel(cha.channel_id);
			if (!channel) continue;
			opt.addButtonInput("", channel.name, () => {
				dio.hide();
				this.loadChannel(channel.id);
			});
			opt.addText(cha.description);
			i++;
			if (i !== this.welcomeScreen.welcome_channels.length)
				opt.addHTMLArea(document.createElement("hr"));
		}

		dio.show();
	}
	welcomeScreen?: welcomeScreen;
	/** Sends `body` to the welcome-screen endpoint, says why when refused, true when saved. */
	private async saveWelcomeScreen(body: unknown): Promise<boolean> {
		const res = await fetch(this.info.api + "/guilds/" + this.id + "/welcome-screen", {
			method: "PATCH",
			headers: this.headers,
			body: JSON.stringify(body),
		}).catch(() => undefined);
		if (!res?.ok) {
			await showRefusal(res);
			return false;
		}
		return true;
	}
	/** Saves the welcome screen as edited. A refused save puts its description back to `saved`, so
	 * a later channel add or removal doesn't send it; returns the description the server holds. */
	private async saveWelcomeEdits(screen: welcomeScreen, saved: string) {
		if (await this.saveWelcomeScreen(screen)) return screen.description;
		screen.description = saved;
		return saved;
	}
	generateSettings() {
		const settings = new Settings(I18n.guild.settingsFor(this.properties.name));
		const sectionLabel = (path: string, fallback: string) => {
			try {
				return I18n.getTranslation(path);
			} catch {
				return fallback;
			}
		};
		settings.addSection(sectionLabel("settingsCategories.guild.general", "General"));
		const textChannels = this.channels.filter((e) => {
			//TODO there are almost certainly more types. is Voice valid?
			return new Set([0, 5]).has(e.type);
		});
		if (this.member.hasPermission("MANAGE_GUILD")) {
			const overview = settings.addButton(I18n.guild.overview());
			const form = overview.addForm("", (_) => {}, {
				headers: this.headers,
				traditionalSubmit: true,
				fetchURL: this.info.api + "/guilds/" + this.id,
				method: "PATCH",
			});
			form.addTextInput(I18n.guild["name:"](), "name", {
				initText: this.properties.name,
			});

			form.addImageInput(I18n.guild["banner:"](), "banner", {
				clear: true,
				width: 96 * 3,
				initImg: this.banner
					? this.info.cdn +
						"/banners/" +
						this.id +
						"/" +
						this.banner +
						".png" +
						new CDNParams({expectedSize: 256})
					: "",
				objectFit: "cover",
			});

			form.addImageInput(I18n.guild["icon:"](), "icon", {
				clear: true,
				initImg: this.properties.icon
					? this.info.cdn +
						"/icons/" +
						this.id +
						"/" +
						this.properties.icon +
						".png" +
						new CDNParams({expectedSize: 256})
					: "",
			});

			form.addImageInput(I18n.guild.splash(), "discovery_splash", {
				clear: true,
				initImg: this.properties.discovery_splash
					? `${this.info.cdn}/discovery-splashes/${this.id}/${this.properties.discovery_splash}.png` +
						new CDNParams({expectedSize: 256})
					: "",
				width: 96 * 2,
			});

			form.addHR();

			console.log(textChannels, this.channels);
			const options = ["DISCOVERABLE", "COMMUNITY", "INVITES_DISABLED"] as const;
			const defaultIndex = options.findIndex((_) => this.properties.features.includes(_));
			form.addSelect(
				I18n.guild.howJoin(),
				"features",
				options.map((_) => I18n.guild[_]()),
				{
					defaultIndex: defaultIndex == -1 ? 2 : defaultIndex,
				},
				options,
			);

			form.addCheckboxInput(I18n.guild.disableInvites(), "invDis", {
				initState: !!this.properties.features.includes("INVITES_DISABLED"),
			});

			form.addCheckboxInput(I18n.guild["sendrandomwelcome?"](), "s1", {
				initState: !(this.properties.system_channel_flags & 1),
			});
			form.addCheckboxInput(I18n.guild["stickWelcomeReact?"](), "s4", {
				initState: !(this.properties.system_channel_flags & 8),
			});
			form.addCheckboxInput(I18n.guild["boostMessage?"](), "s2", {
				initState: !(this.properties.system_channel_flags & 2),
			});
			form.addCheckboxInput(I18n.guild["helpTips?"](), "s3", {
				initState: !(this.properties.system_channel_flags & 4),
			});
			form.addPreprocessor((e: any) => {
				let bits = 0;
				bits += (1 - e.s1) * 1;
				delete e.s1;
				bits += (1 - e.s2) * 2;
				delete e.s2;
				bits += (1 - e.s3) * 4;
				delete e.s3;
				bits += (1 - e.s4) * 8;
				delete e.s4;
				e.system_channel_flags = bits;
				let temp = this.properties.features;
				console.log([...temp]);
				//@ts-ignore
				temp = temp.filter((_) => !options.includes(_));
				temp.push(e.features);
				if (e.features === "DISCOVERABLE") {
					temp.push("COMMUNITY");
				}
				if (e.invDis) {
					if (!temp.includes("INVITES_DISABLED")) {
						temp.push("INVITES_DISABLED");
					}
				} else {
					temp = temp.filter((_) => _ !== "INVITES_DISABLED");
				}
				delete e.invDis;
				if (temp.includes("COMMUNITY")) {
					if (!com) {
						this.addCommunity(settings, textChannels);
						com = true;
					}
				}
				e.features = temp;
			});

			form.addHR();
			form.addSelect(
				I18n.guild.defaultNoti(),
				"default_message_notifications",
				[I18n.guild.onlyMentions(), I18n.guild.all()],
				{
					defaultIndex: [1, 0].indexOf(this.properties.default_message_notifications),
					radio: true,
				},
				[1, 0],
			);
			form.addHR();
			let region = this.properties.region;
			if (!region) {
				region = "";
			}
			form.addTextInput(I18n.guild["region:"](), "region", {initText: region});
		}
		this.makeInviteMenu(settings.addButton(I18n.invite.inviteMaker()), textChannels);
		if (this.member.hasPermission("MANAGE_GUILD")) {
			const inviteMenu = settings.addButton(I18n.guild.invites());
			makeInviteMenu(inviteMenu, this, this.info.api + `/guilds/${this.id}/invites`);
		}
		let com = false;
		if (this.properties.features.includes("COMMUNITY")) {
			if (this.member.hasPermission("MANAGE_GUILD")) this.addCommunity(settings, textChannels);
			com = true;
		}
		settings.addSection(sectionLabel("settingsCategories.guild.roles", "Roles"));
		if (this.member.hasPermission("MANAGE_ROLES")) {
			const s1 = settings.addButton(I18n.guild.roles(), {optName: "", fullWidth: true});
			const permlist: [Role, Permissions][] = [];
			for (const thing of this.roles) {
				permlist.push([thing, thing.permissions]);
			}
			s1.options.push(new RoleList(permlist, this, this.updateRolePermissions.bind(this), false));
		}
		settings.addSection(sectionLabel("settingsCategories.guild.bans", "Bans"));
		if (this.member.hasPermission("BAN_MEMBERS")) {
			const banMenu = settings.addButton(I18n.guild.bans(), {fullWidth: true});
			banMenu.addButtonInput("", I18n.guild.banId(), () => {
				const opt = banMenu.addSubOptions(I18n.guild.banId(), {noSubmit: true});
				const reason = opt.addTextInput(I18n.member["reason:"](), () => {});
				opt.addTextInput(I18n.guild.idSel(), async (id) => {
					const headers = structuredClone(this.headers);
					if (reason.value) (headers as any)["x-audit-log-reason"] = encodeURIComponent(reason.value);
					const ret = await fetch(`${this.info.api}/guilds/${this.id}/bans/${id}`, {
						method: "PUT",
						headers,
					}).catch(() => undefined);
					if (!ret?.ok) {
						await showRefusal(ret);
						return;
					}
					banMenu.returnFromSub();
				});
				opt.addButtonInput("", I18n.submit(), () => {
					opt.submit();
				});
			});
			const makeBanMenu = () => {
				const banDiv = document.createElement("div");
				const bansp = ProgessiveDecodeJSON<banObj[]>(
					this.info.api + "/guilds/" + this.id + "/bans",
					{
						headers: this.headers,
					},
				);
				const createBanHTML = (ban: banObj) => {
					const div = document.createElement("div");
					div.classList.add("flexltr", "bandiv");
					let src: string;
					if (ban.user.avatar !== null) {
						src =
							`${this.info.cdn}/avatars/${ban.user.id}/${ban.user.avatar}.png` +
							new CDNParams({expectedSize: 96});
					} else {
						const int = Number((BigInt(ban.user.id) >> 22n) % 6n);
						src = `${this.info.cdn}/embed/avatars/${int}.png`;
					}
					const img = createImg(src);
					img.classList.add("pfp");
					const divUserRes = document.createElement("div");
					divUserRes.classList.add("flexttb");

					const username = document.createElement("span");
					username.textContent = ban.user.username;

					divUserRes.append(username);
					if (ban.reason) {
						const reason = document.createElement("span");
						reason.innerText = ban.reason;
						divUserRes.append(I18n.guild.banReason(ban.reason));
					}
					div.append(img, divUserRes);
					div.onclick = async (_) => {
						const opt = banMenu.addSubOptions(ban.user.username);

						opt.addHTMLArea(img.cloneNode(true) as HTMLElement);
						opt.addText(ban.user.username);
						if (ban.reason) opt.addText(I18n.guild.banReason(ban.reason));
						//FIXME the API sends back the wrong response, so I don't have this info
						/*
					const moreInfo = (await (
						await fetch(this.info.api + "/guilds/" + this.id + "/bans/" + ban.user.id, {
							headers: this.headers,
						})
					).json()) as addInfoBan;
					const userWhoBanned = await User.resolve(moreInfo.executor_id, this.localuser);
					opt.addHTMLArea(userWhoBanned.createWidget(this));
					//*/
						opt.addButtonInput("", I18n.user.unban(ban.user.username), async () => {
							if (!(await this.unban(ban.user.id))) return;
							bansArr = bansArr.filter((_) => _ !== ban);
							loadPage(currentPage);
							banMenu.returnFromSub();
						});
					};
					return div;
				};
				let bansArr: banObj[] = [];
				let onpage = 0;
				async function loadArr() {
					let bansArr2: banObj[] = [];
					let waiting = false;
					async function addHTML() {
						if (waiting) return;
						waiting = true;
						await new Promise((res) => setTimeout(res, 0));
						waiting = false;
						banDiv.append(...bansArr2.map((ban) => createBanHTML(ban)));
						bansArr2 = [];
					}
					while (!(await bansp).done) {
						const ban = await (await (await bansp).getNext()).getWhole();
						bansArr.push(ban);
						if (onpage < 50) {
							bansArr2.push(ban);
							addHTML();
							onpage++;
						} else {
							next.disabled = false;
						}
					}
				}
				let currentPage = 0;
				function loadPage(page = 0) {
					banDiv.innerHTML = "";
					for (onpage = 0; onpage < 50; onpage++) {
						const ban = bansArr[onpage + page * 50];
						if (!ban) break;
						banDiv.append(createBanHTML(ban));
					}
					if (onpage === 50 && bansArr[onpage + page * 50]) {
						next.disabled = false;
					} else {
						next.disabled = true;
					}
				}

				const pageNav = document.createElement("div");
				const back = document.createElement("button");
				back.textContent = I18n.search.back();
				back.disabled = !currentPage;
				back.onclick = () => {
					back.disabled = !(currentPage - 1);
					next.disabled = false;
					loadPage(--currentPage);
				};

				const next = document.createElement("button");
				next.textContent = I18n.search.next();
				next.disabled = true;
				pageNav.append(back, next);
				banMenu.addHTMLArea(pageNav);
				next.onclick = () => {
					loadPage(++currentPage);
					back.disabled = false;
				};

				loadArr();
				loadPage(currentPage);
				return banDiv;
			};
			banMenu.addHTMLArea(makeBanMenu);
		}
		settings.addSection(sectionLabel("settingsCategories.guild.expressions", "Expressions"));
		if (this.member.hasPermission("MANAGE_GUILD_EXPRESSIONS")) {
			const emoji = settings.addButton(I18n.emoji.title());
			emoji.addButtonInput("", I18n.emoji.upload(), () => {
				const popup = new Dialog(I18n.emoji.upload());
				const form = popup.options.addForm(
					"",
					() => {
						popup.hide();
					},
					{
						fetchURL: `${this.info.api}/guilds/${this.id}/emojis`,
						method: "POST",
						headers: this.headers,
					},
				);
				form.addFileInput(I18n.emoji["image:"](), "image", {required: true});
				form.addTextInput(I18n.emoji["name:"](), "name", {required: true});
				popup.show();
			});
			const containdiv = document.createElement("div");
			containdiv.classList.add("stickersDiv", "emojiGrid");
			const genDiv = () => {
				containdiv.innerHTML = "";
				for (const emjData of this.emojis) {
					const div = document.createElement("div");
					div.classList.add("emojiOption");
					const emojic = new Emoji(emjData, this);

					const img = emojic.getHTML(true);
					img.classList.add("emojiGridImg");
					div.append(img);

					const nameSpan = document.createElement("span");
					nameSpan.classList.add("emojiGridName");
					nameSpan.textContent = emjData.name;
					nameSpan.onclick = (e) => {
						e.stopPropagation();
						const input = document.createElement("input");
						input.type = "text";
						input.value = emjData.name;
						input.className = "emojiNameInput";
						nameSpan.replaceWith(input);
						input.focus();
						input.select();
						const save = () => {
							const newName = input.value.trim();
							if (newName && newName !== emjData.name) {
								fetch(this.info.api + "/guilds/" + this.id + "/emojis/" + emjData.id, {
									method: "PATCH",
									headers: this.headers,
									body: JSON.stringify({name: newName}),
								})
									.catch(() => undefined)
									.then(async (res) => {
										if (res?.ok) {
											emjData.name = newName;
										} else {
											input.value = emjData.name;
											await showRefusal(res);
										}
									});
							}
							input.replaceWith(nameSpan);
						};
						input.onblur = save;
						input.onkeydown = (ke) => {
							if (ke.key === "Enter") {
								ke.preventDefault();
								input.blur();
							}
							if (ke.key === "Escape") {
								ke.preventDefault();
								input.value = emjData.name;
								input.blur();
							}
						};
					};
					div.append(nameSpan);

					const del = document.createElement("span");
					del.classList.add("svgicon", "svg-x", "emojiGridDel");
					del.onclick = (e) => {
						e.stopPropagation();
						const diaolog = new Dialog("");
						diaolog.options.addTitle(I18n.emoji.confirmDel());
						const options = diaolog.options.addOptions("", {ltr: true});
						options.addButtonInput("", I18n.yes(), async () => {
							diaolog.hide();
							const res = await fetch(`${this.info.api}/guilds/${this.id}/emojis/${emjData.id}`, {
								method: "DELETE",
								headers: this.headers,
							}).catch(() => undefined);
							if (!res?.ok) {
								await showRefusal(res);
							}
						});
						options.addButtonInput("", I18n.no(), () => {
							diaolog.hide();
						});
						diaolog.show();
					};

					div.append(del);

					containdiv.append(div);
				}
			};
			this.onEmojiUpdate = () => {
				if (!document.body.contains(containdiv)) {
					this.onEmojiUpdate = () => {};
					return;
				}
				genDiv();
			};
			genDiv();
			emoji.addHTMLArea(containdiv);
		}
		if (this.member.hasPermission("MANAGE_GUILD_EXPRESSIONS")) {
			const emoji = settings.addButton(I18n.sticker.title());
			emoji.addButtonInput("", I18n.sticker.upload(), () => {
				const popup = new Dialog(I18n.sticker.upload());
				const form = popup.options.addForm("", async () => {
					const body = new FormData();
					body.set("name", name.value);
					if (!filei.value) throw new FormError(filei, I18n.sticker.errFileMust());
					const file = filei.value.item(0);
					if (!file) throw new FormError(filei, I18n.sticker.errFileMust());
					body.set("file", file);
					if (!tags.value) throw new FormError(tags, I18n.sticker.errEmjMust());
					if (tags.value.id) {
						body.set("tags", tags.value.id);
					} else if (tags.value.emoji) {
						body.set("tags", tags.value.emoji);
					} else {
						throw new FormError(tags, I18n.sticker.errEmjMust());
					}
					const res = await fetch(this.info.api + "/guilds/" + this.id + "/stickers", {
						method: "POST",
						headers: {
							Authorization: this.headers.Authorization,
						},
						body,
					});
					if (res.ok) {
						popup.hide();
					} else {
						const json = await res.json();
						if ("message" in json && typeof json.message === "string") {
							throw new FormError(filei, json.message);
						}
					}
				});
				const filei = form.addFileInput(I18n.sticker.image(), "file", {required: true});
				const name = form.addTextInput(I18n.sticker.name(), "name", {required: true});
				const tags = form.addEmojiInput(I18n.sticker.tags(), "tags", this.localuser, {
					required: true,
				});
				popup.show();
			});
			const containdiv = document.createElement("div");
			containdiv.classList.add("stickersDiv");
			const genDiv = () => {
				containdiv.innerHTML = "";
				for (const sticker of this.stickers) {
					const div = document.createElement("div");
					div.classList.add("flexttb", "stickerOption");

					const text = document.createElement("span");
					text.textContent = sticker.name;

					div.onclick = () => {
						const form = emoji.addSubForm(emoji.name, () => {}, {
							fetchURL: this.info.api + "/guilds/" + this.id + "/stickers/" + sticker.id,
							method: "PATCH",
							headers: this.headers,
							traditionalSubmit: true,
						});

						form.addHTMLArea(sticker.getHTML());
						form.addTextInput(I18n.sticker.name(), "name", {
							initText: sticker.name,
						});

						form.addMDInput(I18n.sticker.desc(), "description", {
							initText: sticker.description,
						});

						let initEmoji = Emoji.getEmojiFromIDOrString(sticker.tags, this.localuser);
						form.addEmojiInput(I18n.sticker.tags(), "tags", this.localuser, {
							initEmoji,
							required: false,
						});

						form.addButtonInput("", I18n.sticker.del(), () => {
							const diaolog = new Dialog("");
							diaolog.options.addTitle(I18n.sticker.confirmDel());
							const options = diaolog.options.addOptions("", {ltr: true});
							options.addButtonInput("", I18n.yes(), async () => {
								diaolog.hide();
								const res = await fetch(`${this.info.api}/guilds/${this.id}/stickers/${sticker.id}`, {
									method: "DELETE",
									headers: this.headers,
								}).catch(() => undefined);
								if (!res?.ok) {
									await showRefusal(res);
								}
							});
							options.addButtonInput("", I18n.no(), () => {
								diaolog.hide();
							});
							diaolog.show();
						});
					};

					div.append(sticker.getHTML(), text);

					containdiv.append(div);
				}
			};
			this.onStickerUpdate = () => {
				emoji.returnFromSub();
				if (!document.body.contains(containdiv)) {
					this.onStickerUpdate = () => {};
					return;
				}
				genDiv();
			};
			genDiv();
			emoji.addHTMLArea(containdiv);
		}
		settings.addSection(sectionLabel("settingsCategories.guild.community", "Community"));
		if (this.member.hasPermission("MANAGE_GUILD")) {
			const onboard = settings.addButton(I18n.onboarding.name());
			const genOnboard = async () => {
				const res = await fetch(this.info.api + "/guilds/" + this.id + "/welcome-screen", {
					headers: this.headers,
				}).catch(() => undefined);
				if (!res?.ok) {
					// The section keeps its previous state; no rebuild from an answer we don't have.
					await showRefusal(res);
					return;
				}
				this.welcomeScreen = (await res.json().catch(() => null)) ?? undefined;
				onboard.removeAll();
				if (this.welcomeScreen?.enabled) {
					const welcomeScreen = this.welcomeScreen;
					let savedDescription = welcomeScreen.description;
					onboard.afterSubmit = async () => {
						savedDescription = await this.saveWelcomeEdits(welcomeScreen, savedDescription);
					};
					onboard.addButtonInput("", I18n.onboarding.disable(), async () => {
						if (await this.saveWelcomeScreen({enabled: false})) {
							this.welcomeScreen = undefined;
							genOnboard();
						}
					});
					onboard.addButtonInput("", I18n.onboarding.addChannel(), () => {
						const d = new Dialog(I18n.onboarding.addChannel());
						const form = d.options.addForm("", async (o) => {
							const obj = o as {description: string; channel_id: string};
							const welcome_channels = [...welcomeScreen.welcome_channels, obj];
							if (await this.saveWelcomeScreen({...welcomeScreen, welcome_channels})) {
								welcomeScreen.welcome_channels = welcome_channels;
								d.hide();
								welcome(obj);
							}
						});
						const channels = this.channels.filter((channel) => {
							if (channel.isThread()) return false;
							if (channel.type === 4) return false;
							if (welcomeScreen.welcome_channels.find((c) => c.channel_id === channel.id))
								return false;
							return true;
						});
						form.addSelect(
							I18n.onboarding.channel(),
							"channel_id",
							channels.map(({name}) => name),
							{},
							channels.map(({id}) => id),
						);
						form.addTextInput(I18n.onboarding.desc(), "description");
						d.show();
					});
					onboard.addMDInput(
						I18n.onboarding.desc(),
						(desc) => {
							welcomeScreen.description = desc;
						},
						{
							initText: welcomeScreen.description,
						},
					);
					const welcome = (obj: {channel_id: string; description: string}) => {
						const {channel_id, description} = obj;
						const opt = onboard.addOptions("");
						const channel = this.getChannel(channel_id);
						if (!channel) return;
						opt.addTitle(channel.name);
						opt.addTextInput(
							I18n.onboarding.desc(),
							(desc) => {
								obj.description = desc;
							},
							{initText: description},
						);
						opt.addButtonInput("", I18n.onboarding.deleteChannel(), async () => {
							const welcome_channels = welcomeScreen.welcome_channels.filter(
								(entry) => entry.channel_id !== channel_id,
							);
							if (await this.saveWelcomeScreen({...welcomeScreen, welcome_channels})) {
								welcomeScreen.welcome_channels = welcome_channels;
								opt.removeAll();
							}
						});
					};
					welcomeScreen.welcome_channels.forEach(welcome);
				} else {
					onboard.addButtonInput("", I18n.onboarding.enable(), () => {
						const d = new Dialog("");
						const form = d.options.addForm("", async (o) => {
							const obj = o as {description: string};
							const welcome_screen = {
								description: obj.description,
								enabled: true,
								welcome_channels: [],
							} satisfies extendedProperties["welcome_screen"];
							if (await this.saveWelcomeScreen(welcome_screen)) {
								this.welcomeScreen = welcome_screen;
								d.hide();
								genOnboard();
							}
						});
						form.addTextInput(I18n.onboarding.desc(), "description");
						d.show();
					});
				}
			};
			genOnboard();
		}
		if (this.member.hasPermission("MANAGE_GUILD")) {
			const widgetMenu = settings.addButton(I18n.widget());
			(async () => {
				const cur = (await (
					await fetch(this.info.api + "/guilds/" + this.id + "/widget", {
						headers: this.headers,
					})
				).json()) as {
					enabled: boolean;
					channel_id?: null | string;
				};
				const form = widgetMenu.addForm("", () => {}, {
					traditionalSubmit: true,
					fetchURL: this.info.api + "/guilds/" + this.id + "/widget",
					headers: this.headers,
					method: "PATCH",
				});
				form.addCheckboxInput(I18n.widgetEnabled(), "enabled", {initState: cur.enabled});
				const channels = this.channels.filter((_) => _.type !== 4);
				form.addSelect(
					I18n.channel.name(),
					"channel_id",
					channels.map((_) => _.name),
					{
						defaultIndex: channels.findIndex((_) => _.id == cur.channel_id),
					},
					channels.map((_) => _.id),
				);
			})();
		}
		settings.addSection(sectionLabel("settingsCategories.guild.integrations", "Integrations"));
		if (this.member.hasPermission("MANAGE_WEBHOOKS")) {
			const webhooks = settings.addButton(I18n.webhooks.base());
			webhookMenu(this, this.info.api + `/guilds/${this.id}/webhooks`, webhooks);
		}
		if (this.member.hasPermission("MANAGE_GUILD")) {
			const template = settings.addButton(I18n.guild.templates());
			this.loadTemplates(template);
		}
		settings.show();
	}
	/** The Templates settings button's content: the guild's template list, newest first. */
	private async loadTemplates(template: Options) {
		template.addText(I18n.guild.templcateMetaDesc());
		const generateTemplateArea = (temp: templateSkim) => {
			const div = document.createElement("div");
			div.classList.add("flexltr", "templateMiniBox");
			const code = document.createElement("span");

			code.textContent = temp.code + ` (${temp.name})`;

			const edit = document.createElement("button");
			edit.textContent = I18n.edit();
			edit.onclick = () => {
				const form = template.addSubForm(
					I18n.guild.editingTemplate(temp.name),
					(tempy) => {
						const template = tempy as templateSkim;
						temp.name = template.name;
						temp.description = template.description;
					},
					{
						fetchURL: this.info.api + "/guilds/" + this.id + "/templates/" + temp.code,
						method: "PATCH",
						headers: this.headers,
					},
				);
				const search = new URLSearchParams([["instance", this.info.wellknown]]);
				form.addMDText(
					new MarkDown(
						I18n.guild.templateURL(
							window.location.origin + "/template/" + temp.code + "?" + search,
						),
						undefined,
					),
				);

				const name = form.addTextInput(I18n.guild.templateName(), "name", {
					initText: temp.name,
				});
				form.addMDInput(I18n.guild.templateDesc(), "description", {
					initText: temp.description,
				});
				User.resolve(temp.creator_id, this.localuser).then(
					(_) => {
						form.addText(I18n.guild.tempCreatedBy());
						form.addHTMLArea(_.createWidget(this));
					},
					// A failed lookup leaves the row out; the rest of the form is unaffected.
					() => undefined,
				);
				form.addText(I18n.guild.tempUseCount((temp.usage_count || 0) + ""));
				form.addPreprocessor(() => {
					if (name.value.length < 2) {
						throw new FormError(name, I18n.guild.templateNameShort());
					}
				});
			};

			div.append(code, edit);
			template.addHTMLArea(div);
		};
		template.addButtonInput("", I18n.guild.createNewTemplate(), () => {
			const form = template.addSubForm(
				I18n.guild.createNewTemplate(),
				(code) => {
					template.returnFromSub();
					generateTemplateArea(code as templateSkim);
				},
				{
					fetchURL: this.info.api + "/guilds/" + this.id + "/templates",
					method: "POST",
					headers: this.headers,
				},
			);
			form.addText(I18n.guild.templcateMetaDesc());
			const name = form.addTextInput(I18n.guild.templateName(), "name");
			form.addMDInput(I18n.guild.templateDesc(), "description");
			form.addPreprocessor(() => {
				if (name.value.length < 2) {
					throw new FormError(name, I18n.guild.templateNameShort());
				}
			});
		});
		const res = await fetch(this.info.api + "/guilds/" + this.id + "/templates", {headers: this.headers});
		const templates = (await res.json().catch(() => undefined)) as templateSkim[] | undefined;
		if (!Array.isArray(templates)) {
			template.addText(I18n.requestFailed(`HTTP ${res.status}`));
			return;
		}
		for (const temp of templates.reverse()) {
			generateTemplateArea(temp);
		}
	}
	onStickerUpdate = (_stickers: Sticker[]) => {};
	addCommunity(settings: Settings, textChannels: Channel[]) {
		const com = settings.addButton(I18n.guild.community()).addForm("", () => {}, {
			fetchURL: this.info.api + "/guilds/" + this.id,
			method: "PATCH",
			headers: this.headers,
			traditionalSubmit: true,
		});
		{
			com.addMDInput(I18n.guild["description:"](), "description", {
				initText: this.properties.description,
			});
		}
		{
			let defaultIndex = textChannels.findIndex((_) => this.properties.rules_channel_id == _.id);
			if (defaultIndex === -1) {
				defaultIndex = textChannels.length;
			}
			com.addSelect(
				I18n.guild.ruleId(),
				"rules_channel_id",
				[...textChannels.map((_) => _.name), "none"],
				{
					defaultIndex,
				},
				[...textChannels.map((_) => _.id), undefined],
			);
		}
		{
			const sysmap = [null, ...textChannels.map((e) => e.id)];
			com.addSelect(
				I18n.guild["systemSelect:"](),
				"system_channel_id",
				[I18n.guild.noSystemChannel(), ...textChannels.map((e) => e.name)],
				{defaultIndex: sysmap.indexOf(this.properties.system_channel_id)},
				sysmap,
			);
		}
	}
	makeInviteMenu(options: Options, valid: void | Channel[]) {
		if (!valid) {
			valid = this.channels.filter((e) => {
				//TODO there are almost certainly more types. is Voice valid?
				return new Set([0, 5]).has(e.type);
			});
		}
		let channel = valid[0];
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
			// No channel an invite can point at (no text channels): nothing to make.
			if (!channel) return;
			void showNewInvite(
				`${this.info.api}/channels/${channel.id}/invites`,
				this.headers,
				{max_age: expires, max_uses: uses},
				this.info.wellknown,
				text,
			);
		};

		options.addTitle(I18n.inviteOptions.title());
		const text2 = options.addText("");
		options
			.addSelect(
				I18n.invite["channel:"](),
				() => {},
				valid.map((e) => e.name),
			)
			.watchForChange((e) => {
				channel = valid[e];
				text2.setText(I18n.invite.subtext(channel.name, this.properties.name));
			});

		options.addSelect(
			I18n.invite.expireAfter(),
			() => {},
			(["30m", "1h", "6h", "12h", "1d", "7d", "30d", "never"] as const).map((e) =>
				I18n.inviteOptions[e](),
			),
		).onchange = (e) => {
			expires = [1800, 3600, 21600, 43200, 86400, 604800, 2592000, 0][e];
		};

		const timeOptions = ["1", "5", "10", "25", "50", "100"].map((e) => I18n.inviteOptions.limit(e));
		timeOptions.unshift(I18n.inviteOptions.noLimit());
		options.addSelect(I18n.invite.expireAfter(), () => {}, timeOptions).onchange = (e) => {
			uses = [0, 1, 5, 10, 25, 50, 100][e];
		};

		options.addButtonInput("", I18n.invite.createInvite(), () => {
			update();
		});

		options.addHTMLArea(div);
	}
	roleUpdate: (role: Role, added: -1 | 0 | 1) => unknown = () => {};
	sortRoles() {
		this.roles.sort((a, b) => b.position - a.position);
	}
	async recalcRoles(previous?: Role[]): Promise<boolean> {
		let position = this.roles.length;
		const map = this.roles.map((_) => {
			position--;
			return {id: _.id, position};
		});
		const res = await fetch(this.info.api + "/guilds/" + this.id + "/roles", {
			method: "PATCH",
			body: JSON.stringify(map),
			headers: this.headers,
		}).catch(() => undefined);
		if (!res?.ok) {
			if (previous) this.roles = previous;
			await showRefusal(res);
			return false;
		}
		return true;
	}
	/** After roles change (all members', or one `member`'s): re-point drawn names at each member's
	 * current top coloured role, and regroup the member list by hoisted role if it's on screen. */
	redrawForRoles(member?: Member) {
		const names = `span[data-role-colour-guild="${this.id}"]`;
		if (member) {
			for (const span of document.querySelectorAll<HTMLElement>(
				`${names}[data-role-colour-member="${member.id}"]`,
			)) {
				member.bind(span);
			}
		} else {
			const byId = new Map<string, Member>();
			for (const thing of this.members) {
				byId.set(thing.id, thing);
			}
			for (const span of document.querySelectorAll<HTMLElement>(names)) {
				byId.get(span.dataset.roleColourMember ?? "")?.bind(span);
			}
		}
		if (this.localuser.lookingguild === this) {
			this.localuser.memberListQue();
		}
	}
	newRole(rolej: rolesjson) {
		const role = new Role(rolej, this);
		this.roles.push(role);
		this.roleids.set(role.id, role);
		this.sortRoles();
		this.roleUpdate(role, 1);
		this.redrawForRoles();
	}
	updateRole(rolej: rolesjson) {
		const role = this.roleids.get(rolej.id) as Role;
		role.newJson(rolej);
		// A role moved elsewhere (another admin's drag) takes its new rank: colours and the
		// member list read this order.
		this.sortRoles();
		this.roleUpdate(role, 0);
		this.recalcPrivate();
		this.redrawForRoles();
	}
	memberupdate(json: memberjson) {
		// Discord's (and the server's role and nick routes') payload names the member by its user.
		const id = json.id ?? json.user?.id;
		let member: undefined | Member = undefined;
		for (const thing of this.members) {
			if (thing.id === id) {
				member = thing;
				break;
			}
		}

		if (!member) return;
		member.update(json);
		this.redrawForRoles(member);
		// Your own roles changed: redraw the open guild for them; another guild redraws when opened.
		if (member === this.member && this.localuser.lookingguild === this) {
			this.localuser.loadGuild(this.id, true);
		}
	}
	deleteRole(id: string) {
		const role = this.roleids.get(id);
		if (!role) return;
		this.roleids.delete(id);
		this.roles.splice(this.roles.indexOf(role), 1);
		this.roleUpdate(role, -1);
		this.redrawForRoles();
	}
	onEmojiUpdate = (_: emojipjson[]) => {};
	update(json: extendedProperties) {
		this.large = json.large;
		this.member_count = json.member_count;
		this.emojis = json.emojis || [];
		this.headers = this.owner.headers;
		this.welcomeScreen = json.welcome_screen;
		const iconChanged = this.properties.icon !== json.icon || this.properties.name !== json.name;
		// The payload is the whole guild object; its collections and relations have their own events and stores.
		const {
			emojis,
			roles,
			stickers,
			channels,
			members,
			threads,
			voice_states,
			presences,
			bans,
			invites,
			webhooks,
			owner,
			afk_channel,
			rules_channel,
			system_channel,
			public_updates_channel,
			widget_channel,
			template,
			...properties
		} = json as extendedProperties & Record<string, unknown>;
		for (const [key, value] of Object.entries(properties)) {
			if (assignableKey(this.properties, key)) (this.properties as Record<string, unknown>)[key] = value;
		}
		// Spacebar sends an unset channel as an absent key, not null.
		for (const key of ["afk_channel_id", "system_channel_id", "rules_channel_id", "public_updates_channel_id"]) {
			if (!(key in json)) (this.properties as Record<string, unknown>)[key] = null;
		}
		if (iconChanged && this.HTMLicon) {
			const divy = this.generateGuildIcon();
			this.HTMLicon.replaceWith(divy);
			this.HTMLicon = divy;
		}
		if (this.owner.lookingguild === this) {
			(document.getElementById("serverName") as HTMLElement).textContent = this.properties.name;
		}
		this.banner = json.banner;
	}
	constructor(json: guildjson | -1, owner: Localuser, member: memberjson | User | null) {
		super(typeof json === "number" ? "@me" : json.id);
		this.owner = owner;
		this.perminfo ??= {channels: {}};
		this.headers = this.owner.headers;

		if (json === -1 || member === null) {
			return;
		}
		this.large = json.large;
		this.member_count = json.member_count;
		this.emojis = json.emojis || [];
		this.channels = [];
		if (json.properties) {
			this.properties = json.properties;
		}
		this.roles = [];
		this.roleids = new Map();
		this.banner = json.properties.banner;
		this.welcomeScreen = json.properties.welcome_screen;
		if (json.roles) {
			for (const roley of json.roles) {
				const roleh = new Role(roley, this);
				this.roles.push(roleh);
				this.roleids.set(roleh.id, roleh);
			}
		}

		this.message_notifications = 0;
		this.sortRoles();
		// A deep-link boot (the invite accept's landing, a bare /channels/:guildId URL)
		// resolves its URL while this member fetch is still in flight; without the member
		// every channel reads invisible and the boot parks in noChannel. init() awaits this
		// before touching the URL, so the channels are visible when it looks at them. The
		// fetch failure settles resolved with the member unset (init then parks in
		// noChannel, as before this field existed) — a rejection here would throw out of
		// init's callers.
		this.memberReady = (member instanceof User
			? Member.resolveMember(member, this)
			: Member.new(member, this)
		)
			.then((_) => {
				if (!_) {
					if (member instanceof User) console.error("Member was unable to resolve");
					return;
				}
				this.member = _;
			})
			.catch((e) => console.error("Member fetch failed", e));

		for (const thing of json.channels) {
			const temp = new Channel(thing, this);
			this.channels.push(temp);
			this.localuser.channelids.set(temp.id, temp);
		}

		this.headchannels = [];
		for (const thing of this.channels) {
			const parent = thing.resolveparent(this);
			if (!parent) {
				this.headchannels.push(thing);
			}
		}
		for (const thread of json.threads) {
			if (this.localuser.channelids.has(thread.id)) continue;
			const temp = new Channel(thread, this);
			this.localuser.channelids.set(temp.id, temp);
			temp.resolveparent(this);
		}
		this.prevchannel = this.localuser.channelids.get(this.perminfo.prevchannel);
		this.stickers = json.stickers.map((_) => new Sticker(_, this)) || [];
	}
	get perminfo() {
		return this.localuser.perminfo.guilds[this.id];
	}
	set perminfo(e) {
		this.localuser.perminfo.guilds[this.id] = e;
	}
	mute_config!: mute_config | null;
	notisetting(settings: GuildOverrides) {
		this.mute_config = settings.mute_config;
		this.message_notifications = settings.message_notifications;
		for (const override of settings.channel_overrides) {
			const channel = this.localuser.channelids.get(override.channel_id);
			if (!channel) continue;
			channel.handleUserOverrides(override);
		}
	}
	setnotifcation() {
		const options = (["all", "onlyMentions", "none"] as const).map((e) => I18n.guild[e](e));
		const notiselect = new Dialog("");
		const form = notiselect.options.addForm(
			"",
			(_, sent: any) => {
				notiselect.hide();
				this.message_notifications = sent.message_notifications;
			},
			{
				fetchURL: `${this.info.api}/users/@me/guilds/${this.id}/settings/`,
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
			[0, 1, 2],
		);
		notiselect.show();
	}
	/** Counts this guild's mute and unmute PATCHes, so a newer one cancels an older one's 429 retry. */
	private muteSeq?: number;
	/** While mute changes are in flight: the config the server last accepted (boxed: it may be
	 * null), so a refusal goes back to it rather than to an earlier unanswered change. */
	private acceptedMute?: {config: mute_config | null; inFlight: number};
	/** Sends a mute or unmute setting; if the latest change is refused, the guild goes back to
	 * the config the server holds. Call it before applying `mute_config` locally. */
	private async sendMuteConfig(muted: boolean, mute_config: mute_config, seq: number) {
		// With nothing in flight, the config shown is the server's (a gateway update may have set it).
		const accepted = (this.acceptedMute ??= {config: this.mute_config, inFlight: 0});
		accepted.inFlight++;
		const res = await fetchRetryOnce(
			`${this.info.api}/users/@me/guilds/${this.id}/settings`,
			{
				method: "PATCH",
				headers: this.headers,
				body: JSON.stringify({
					muted,
					mute_config,
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
			await showRefusal(res);
		}
	}
	unmuteGuild() {
		const seq = (this.muteSeq = (this.muteSeq ?? 0) + 1);
		const mute_config = {
			selected_time_window: -1,
			end_time: 0,
		};
		const req = this.sendMuteConfig(false, mute_config, seq);
		this.mute_config = mute_config;
		this.showMuteState();
		return req;
	}
	muteGuild() {
		const dio = new Dialog(I18n.guild.mute());
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
				end_time: Math.floor(Date.now() + time * 1000),
			};
			const req = this.sendMuteConfig(true, mute_config, seq);
			this.mute_config = mute_config;
			this.showMuteState();
			dio.hide();
			return req;
		});
		dio.show();
	}
	private muteTimer?: ReturnType<typeof setTimeout>;
	/** Shows the pillar icon muted while the mute lasts, and unmuted once it runs out. */
	private showMuteState(div = this.html) {
		clearTimeout(this.muteTimer);
		if (!div) return;
		div.classList.toggle("muted", this.muted);
		if (!this.muted) return;
		const left = new Date(this.mute_config!.end_time).getTime() - Date.now();
		// A timer can't wait past 2^31-1 ms (~24.8 days): a longer mute checks again then.
		this.muteTimer = setTimeout(() => this.showMuteState(), Math.min(left, 2 ** 31 - 1));
	}
	confirmleave() {
		const full = new Dialog("");
		full.options.addTitle(I18n.guild.confirmLeave());
		const options = full.options.addOptions("", {ltr: true});
		options.addButtonInput("", I18n.guild.yesLeave(), async () => {
			const res = await this.leave();
			full.hide();
			if (!res?.ok) {
				await showRefusal(res);
			}
		});
		options.addButtonInput("", I18n.guild.noLeave(), () => {
			full.hide();
		});
		full.show();
	}
	async leave(): Promise<Response | undefined> {
		return fetch(this.info.api + "/users/@me/guilds/" + this.id, {
			method: "DELETE",
			headers: this.headers,
		}).catch(() => undefined);
	}
	printServers() {
		let build = "";
		for (const thing of this.headchannels) {
			build += thing.name + ":" + thing.position + "\n";
			console.log(thing.children);
			for (const thingy of thing.children) {
				build += "   " + thingy.name + ":" + thingy.position + "\n";
			}
		}
		console.log(build);
	}
	/** Counts layout snapshots: only the newest drag's refusal may put the layout back. */
	private layoutSeq?: number;
	/** Records the channel list's arrangement; the returned function puts it back, unless a newer
	 * snapshot was taken since. Channels created since stay (at the end of their list), channels
	 * deleted since stay gone. */
	snapshotLayout(): () => void {
		const seq = (this.layoutSeq = (this.layoutSeq ?? 0) + 1);
		const headchannels = [...this.headchannels];
		const perChannel = this.channels.map((channel) => ({
			channel,
			parent: channel.parent,
			parent_id: channel.parent_id,
			move_id: channel.move_id,
			position: channel.position,
			children: [...channel.children],
		}));
		/** `saved`, less what's gone, then what `now` holds that `saved` didn't. */
		const merge = (saved: Channel[], now: Channel[], live: Set<Channel>, known: Set<Channel>) => [
			...saved.filter((c) => live.has(c)),
			...now.filter((c) => !known.has(c)),
		];
		return () => {
			if (seq !== this.layoutSeq) return;
			const live = new Set(this.channels);
			const known = new Set(perChannel.map(({channel}) => channel));
			this.headchannels = merge(headchannels, this.headchannels, live, known);
			for (const entry of perChannel) {
				if (!live.has(entry.channel)) continue;
				entry.channel.parent = entry.parent;
				entry.channel.parent_id = entry.parent_id;
				entry.channel.move_id = entry.move_id;
				entry.channel.position = entry.position;
				entry.channel.children = merge(entry.children, entry.channel.children, live, known);
			}
			if (this.localuser.lookingguild === this) {
				// In place: loadGuild would also close an open search panel.
				const channels = document.getElementById("channels") as HTMLDivElement;
				channels.innerHTML = "";
				channels.appendChild(this.buildChannelList());
			}
		};
	}
	async calculateReorder(movedId?: string, restore?: () => void) {
		let position = 0;
		type buildtype = {
			id: string;
			position: number | undefined;
			parent_id: string | undefined | null;
		}[];
		const build: buildtype = [];
		for (const thing of this.headchannels) {
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
			if (thing.children.length > 0 && thing.type === 4) {
				let things: buildtype;
				[things, position] = thing.calculateReorder(position);
				for (const thing of things) {
					build.push(thing);
				}
			}
		}
		const find = build.find((_) => _.id === movedId);
		const channel = this.channels.find((_) => _.id === movedId);
		if (!find) {
			if (channel)
				build.push({
					id: channel.id,
					position: channel.position,
					parent_id: channel.parent?.id || null,
				});
		} else {
			if (channel) find.parent_id = channel.parent?.id || null;
		}
		this.printServers();
		if (build.length === 0) {
			return;
		}
		const serverbug = false;
		if (serverbug) {
			for (const thing of build) {
				console.log(build, thing);
				fetch(this.info.api + "/guilds/" + this.id + "/channels", {
					method: "PATCH",
					headers: this.headers,
					body: JSON.stringify([thing]),
				});
			}
		} else {
			const res = await fetch(this.info.api + "/guilds/" + this.id + "/channels", {
				method: "PATCH",
				headers: this.headers,
				body: JSON.stringify(build),
			}).catch(() => undefined);
			if (!res?.ok && restore) {
				restore();
				await showRefusal(res);
			}
		}
	}
	get localuser() {
		return this.owner;
	}
	get info() {
		return this.owner.info;
	}
	sortchannels() {
		this.headchannels.sort((a, b) => {
			return a.position - b.position;
		});
	}
	HTMLicon?: HTMLElement;
	static generateGuildIcon(
		guild: Guild | {id: string; name: string; icon: string | null; info: {cdn: string}},
		autoLink = true,
	) {
		const divy = document.createElement("div");
		divy.classList.add("servernoti");

		const noti = document.createElement("div");
		noti.classList.add("unread");
		divy.append(noti);
		if (guild instanceof Guild && autoLink) {
			guild.localuser.guildhtml.set(guild.id, divy);
			guild.html = divy;
		}
		let icon: string | null;
		if (guild instanceof Guild) {
			icon = guild.properties.icon;
		} else {
			icon = guild.icon;
		}
		const onclick =
			guild instanceof Guild
				? () => {
						guild.loadGuild();
						guild.loadChannel();
					}
				: null;
		const hover = new Hover(guild instanceof Guild ? guild.properties.name : "", {
			side: "right",
			weak: true,
		});
		if (icon !== null) {
			const img = createImg(
				guild.info.cdn +
					"/icons/" +
					guild.id +
					"/" +
					icon +
					".png" +
					new CDNParams({expectedSize: 96}),
			);
			img.classList.add("pfp", "servericon");
			divy.appendChild(img);
			if (guild instanceof Guild && autoLink) {
				img.onclick = onclick;
				Guild.contextmenu.bindContextmenu(img, guild, undefined);
				hover.addEvent(img);
			}
		} else {
			const div = document.createElement("div");
			let name: string;
			if (guild instanceof Guild) {
				name = guild.properties.name;
			} else {
				name = guild.name;
			}
			const build = name
				.replace(/'s /g, " ")
				.replace(/[^\s]+/g, (word) => word[0])
				.replace(/\s/g, "");
			div.textContent = build;
			div.classList.add("blankserver", "servericon");
			divy.appendChild(div);
			if (guild instanceof Guild) {
				div.onclick = onclick;
				Guild.contextmenu.bindContextmenu(div, guild, undefined);
				hover.addEvent(div);
			}
		}
		return divy;
	}
	generateGuildIcon(autoLink = true) {
		return Guild.generateGuildIcon(this, autoLink);
	}
	confirmDelete() {
		const full = new Dialog("");
		full.options.addTitle(I18n.guild.confirmDelete(this.properties.name));
		// Through the form, so a refusal shows; an owner with two-factor on also gives a code.
		const form = full.options.addForm("", () => full.hide(), {
			submitText: "",
			fetchURL: this.info.api + "/guilds/" + this.id + "/delete",
			method: "POST",
			headers: this.headers,
		});
		// Keyed "": checked here, never sent.
		const txt = form.addTextInput(I18n.guild.serverName(), "");
		this.localuser.addOwnerCode(form);
		form.addPreprocessor(() => {
			if (txt.value !== this.properties.name) throw new FormError(txt, I18n.guild.nameNoMatch());
		});

		const options = form.addOptions("", {ltr: true});
		options.addButtonInput("", I18n.guild.yesDelete(), () => {
			void form.submit();
		});

		options.addButtonInput("", I18n.guild.noDelete(), () => {
			full.hide();
		});
		full.show();
	}
	/** Lifts the ban on `userId`; false (after saying why) when the server refused it. */
	async unban(userId: string): Promise<boolean> {
		const res = await fetch(this.info.api + "/guilds/" + this.id + "/bans/" + userId, {
			headers: this.headers,
			method: "DELETE",
		}).catch(() => undefined);
		if (!res?.ok) {
			await showRefusal(res);
			return false;
		}
		return true;
	}
	get mentions() {
		let mentions = 0;
		for (const thing of this.channels) {
			if (thing.visible) mentions += thing.mentions;
			else if (thing.mentions) console.warn("Hidden Channel has pings:", thing);
		}
		return mentions;
	}
	unreads(html?: HTMLElement | undefined) {
		if (html) {
			this.html = html;
		} else {
			html = this.html;
		}
		this.showMuteState();
		if (!html) {
			return;
		}
		let read = true;
		let mentions = this.mentions;
		for (const thing of this.channels) {
			if (thing.hasunreads && (!thing.isThread() || thing.owner)) {
				read = false;
				break;
			}
		}
		const noti = html.children[0];
		if (mentions !== 0) {
			noti.classList.add("pinged");
			noti.textContent = "" + mentions;
		} else {
			noti.textContent = "";
			noti.classList.remove("pinged");
		}
		if (read) {
			noti.classList.remove("notiunread");
		} else {
			noti.classList.add("notiunread");
		}
	}
	async goToThread(threadId: string) {
		if (!this.localuser.channelids.has(threadId)) {
			const res = await fetch(this.info.api + "/channels/" + threadId, {
				headers: this.headers,
			}).catch(() => undefined);
			const channelJson: channeljson | undefined = res?.ok
				? await res.json().catch(() => undefined)
				: undefined;
			if (!channelJson?.id) {
				// Gone or not visible: the default channel, and no wait for one that won't come.
				await this.loadChannel();
				return;
			}
			const channel = new Channel(channelJson, this);
			this.localuser.channelids.set(channel.id, channel);
			channel.resolveparent(this);
			const par = this.localuser.channelids.get(channel.parent_id as string);
			par?.createguildHTML();
		}
		// Awaited so loadChannel's caller sees the thread focused when it returns.
		await this.localuser.goToChannel(threadId);
	}
	/** Sorts and builds the channel list for #channels. The refused-drag restore swaps this in
	 * directly: it must not touch the search panel or anything outside #channels. */
	buildChannelList(): HTMLElement {
		this.sortchannels();
		const build = document.createElement("div");

		for (const thing of this.headchannels) {
			build.appendChild(thing.createguildHTML());
		}
		return build;
	}
	getHTML() {
		const sideContainDiv = document.getElementById("sideContainDiv");
		if (sideContainDiv) {
			sideContainDiv.classList.remove("searchDiv");
			sideContainDiv.classList.remove("hideSearchDiv");
		}
		const searchBox = document.getElementById("searchBox");
		if (searchBox) searchBox.textContent = "";

		this.printServers();
		return this.buildChannelList();
	}
	isAdmin() {
		return this.member?.isAdmin() ?? false;
	}
	async markAsRead() {
		const build: {
			read_states: {
				channel_id: string;
				message_id: string | null | undefined;
				read_state_type: number;
			}[];
		} = {read_states: []};
		for (const thing of this.channels) {
			if (thing.hasunreads) {
				build.read_states.push({
					channel_id: thing.id,
					message_id: thing.trueLastMessageid,
					read_state_type: 0,
				});
				thing.lastreadmessageid = thing.trueLastMessageid;
				if (!thing.myhtml) continue;
				thing.myhtml.classList.remove("cunread");
			}
		}
		this.unreads();
		const acked = this.channels.filter((c) => build.read_states.some((s) => s.channel_id === c.id));
		const sent = new Map(acked.map((c) => [c, c.lastreadmessageid]));
		fetchRetryOnce(
			this.info.api + "/read-states/ack-bulk",
			{method: "POST", headers: this.headers, body: JSON.stringify(build)},
			// A retry after any of these channels was read further would move it back. Deliberately
			// all-or-nothing: one advanced channel drops the whole batch, and the dropped acks heal
			// from the server's own unread state on the next sync.
			{shouldRetry: () => acked.every((c) => c.lastreadmessageid === sent.get(c))},
		).catch(() => {}); // bookkeeping: nothing reacts to a failed ack
	}
	hasRole(r: Role | string) {
		console.log("this should run");
		if (r instanceof Role) {
			r = r.id;
		}
		return this.member.hasRole(r);
	}
	async loadChannel(ID?: string | undefined | null, addstate = true, message?: string) {
		if (ID) {
			const channel = this.localuser.channelids.get(ID);
			if (channel) {
				await channel.getHTML(addstate, undefined, message);
				return;
			} else {
				await this.goToThread(ID);
				return;
			}
		}
		if (this.prevchannel && ID !== null && this.prevchannel.visible) {
			console.log(this.prevchannel);
			await this.prevchannel.getHTML(addstate, undefined, message);
			return;
		}
		if (this.id !== "@me") {
			for (const thing of this.channels) {
				if (thing.type !== 4 && thing.visible) {
					await thing.getHTML(addstate, undefined, message);
					return;
				}
			}
		}
		this.removePrevChannel();
		this.noChannel(addstate);
	}
	removePrevChannel() {
		if (this.localuser.channelfocus) {
			this.localuser.channelfocus.infinite.delete();
		}
		if (this !== this.localuser.lookingguild) {
			this.loadGuild();
		}
		if (this.localuser.channelfocus && this.localuser.channelfocus.myhtml) {
			this.localuser.channelfocus.myhtml.classList.remove("viewChannel");
		}
		this.prevchannel = undefined;
		this.localuser.channelfocus = undefined;
		Channel.clearScrollWrapLeaks();
		const replybox = document.getElementById("replybox") as HTMLElement;
		const typebox = document.getElementById("typebox") as HTMLElement;
		replybox.classList.add("hideReplyBox");
		typebox.classList.remove("typeboxreplying");
		(document.getElementById("typebox") as HTMLDivElement).contentEditable = "false";
		(document.getElementById("upload") as HTMLElement).style.visibility = "hidden";
		(document.getElementById("typediv") as HTMLElement).style.visibility = "hidden";
		(document.getElementById("sideDiv") as HTMLElement).innerHTML = "";
	}
	noChannel(addstate: boolean) {
		for (const c of this.channels) {
			if (c.visible) {
				this.loadChannel(c.id, addstate);
				return;
			}
		}
		if (addstate) {
			history.pushState([this.id, undefined], "", "/channels/" + this.id);
		}
		this.localuser.pageTitle(I18n.guild.emptytitle());
		const channelTopic = document.getElementById("channelTopic") as HTMLSpanElement;
		channelTopic.setAttribute("hidden", "");

		const loading = document.getElementById("loadingdiv") as HTMLDivElement;
		loading.classList.remove("loading");
		this.localuser.getSidePannel();

		const messages = document.getElementById("scrollWrap") as HTMLDivElement;
		Channel.clearScrollWrapLeaks();
		for (const thing of Array.from(messages.getElementsByClassName("messagecontainer"))) {
			thing.remove();
		}
		const h1 = document.createElement("h1");
		h1.classList.add("messagecontainer");
		h1.textContent = I18n.guild.emptytext();
		messages.append(h1);
	}
	loadGuild() {
		this.localuser.loadGuild(this.id);
	}
	updateChannel(json: channeljson) {
		const channel = this.localuser.channelids.get(json.id);
		if (channel) {
			const parent = channel.parent;
			channel.updateChannel(json);
			this.channels = this.channels.sort((a, b) => a.position - b.position);
			// Moved between categories, or to or from the top level: out of the old list, into the
			// new one (deleting a category moves each child to the top level first).
			if (parent !== channel.parent) {
				if (parent) parent.children = parent.children.filter((_) => _ !== channel);
				else this.headchannels = this.headchannels.filter((_) => _ !== channel);
				if (!channel.resolveparent()) this.headchannels.push(channel);
			}

			for (const channel of this.channels) {
				channel.children = channel.children.sort((a, b) => a.position - b.position);
			}
			this.sortchannels();
			this.printServers();
		}
	}
	createChannelpac(json: channeljson) {
		const thischannel = new Channel(json, this);
		this.localuser.channelids.set(json.id, thischannel);
		this.channels.push(thischannel);
		thischannel.resolveparent(this);
		if (!thischannel.parent) {
			this.headchannels.push(thischannel);
		}
		// A channel someone else created is not a reorder: sortchannels keeps the top level in
		// server-position order without writing positions back (calculateReorder PATCHes).
		// Children of a category keep their arrival order: their sort can't take a thread's
		// missing position.
		this.sortchannels();
		this.printServers();
		return thischannel;
	}
	goToChannelDelay(id: string) {
		const channel = this.channels.find((_) => _.id == id);
		if (channel) {
			this.loadChannel(channel.id);
		} else {
			this.localuser.gotoid = id;
		}
	}
	createchannels(
		func: (name: string, type: number) => Promise<boolean> = this.createChannel.bind(this),
	) {
		const options = (["text", "announcement", "voice", "forum"] as const).map((e) =>
			I18n.channel[e](),
		);

		const channelselect = new Dialog("");
		const form = channelselect.options.addForm("", async (e: any) => {
			if (await func(e.name, e.type)) {
				channelselect.hide();
			}
		});

		form.addSelect(I18n.channel.selectType(), "type", options, {radio: true}, [0, 5, 2, 15]);
		form.addTextInput(I18n.channel.selectName(), "name", {spaceReplace: "_"});
		channelselect.show();
	}
	createcategory() {
		const category = 4;
		const channelselect = new Dialog("");
		const options = channelselect.options;
		const form = options.addForm("", async (e: any) => {
			if (await this.createChannel(e.name, category)) {
				channelselect.hide();
			}
		});
		form.addTextInput(I18n.channel.selectCatName(), "name");
		channelselect.show();
	}
	delChannel(json: channeljson) {
		const channel = this.localuser.channelids.get(json.id);
		this.localuser.channelids.delete(json.id);
		if (!channel) return;
		// A thread isn't in these lists; indexOf's -1 would splice off the last channel.
		this.channels = this.channels.filter((_) => _ !== channel);
		this.headchannels = this.headchannels.filter((_) => _ !== channel);
		const parent = channel.parent;
		if (parent) parent.children = parent.children.filter((_) => _ !== channel);
		if (channel === this.prevchannel) {
			this.prevchannel = undefined;
		}
		/*
		const build=[];
		for(const thing of this.channels){
		console.log(thing.id);
		if(thing!==channel){
		build.push(thing)
		}else{
		console.log("fail");
		if(thing.parent){
		thing.parent.delChannel(json);
		}
		}
		}
		this.channels=build;
		*/
		this.printServers();
	}
	async createChannel(name: string, type: number): Promise<boolean> {
		const res = await fetch(this.info.api + "/guilds/" + this.id + "/channels", {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify({name, type}),
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
		this.goToChannelDelay(body.id);
		return true;
	}
	async updateRolePermissions(id: string, perms: Permissions): Promise<boolean> {
		// The editor keeps mutating `perms` (another role opened mid-save); keep what was sent.
		const {allow, deny} = perms;
		const role = this.roleids.get(id);
		if (!role) {
			// Nothing was sent, so the caller must revert rather than record the bits as accepted.
			return false;
		}
		// Only the permissions: re-sending the rest would send the icon's hash where the server
		// takes an upload.
		const res = await fetch(this.info.api + "/guilds/" + this.id + "/roles/" + role.id, {
			method: "PATCH",
			headers: this.headers,
			body: JSON.stringify({permissions: allow.toString()}),
		}).catch(() => undefined);
		if (!res?.ok) {
			new Dialog(I18n.requestFailed(res ? "HTTP " + res.status : "offline")).show();
			return false;
		}
		role.permissions.allow = allow;
		role.permissions.deny = deny;
		return true;
	}
	/** The apps behind the latest command list asked for (the popup's icons and app names). */
	apps?: applicationJson[];
	/** Command indexes by scope: "" is the guild's own; in "@me" each DM channel has its own,
	 * since each DM has its own bot set. A fetch in flight is shared; a failed one is dropped
	 * so the next ask retries instead of serving "no commands" for the session. */
	private commandIndexes?: Map<string, CommandIndexEntry>;
	private commandIndex(channelId?: string) {
		const scope = this.id === "@me" ? (channelId ?? "") : "";
		this.commandIndexes ??= new Map();
		const indexes = this.commandIndexes;
		let entry = indexes.get(scope);
		if (!entry) {
			const fetched = this.getCommandsFetch(this.id === "@me" ? channelId : undefined);
			const made: CommandIndexEntry = {
				promise: fetched.then(
					({ok, apps, commands}) => {
						if (ok) {
							made.settled = commands;
							const appOwners = new Map<string, string>();
							for (const app of apps ?? []) {
								const ownerId = (app as {owner_id?: string}).owner_id;
								if (ownerId) appOwners.set(app.id, ownerId);
							}
							made.appOwners = appOwners;
						} else if (indexes.get(scope) === made) indexes.delete(scope);
						return {apps, commands};
					},
					() => {
						if (indexes.get(scope) === made) indexes.delete(scope);
						return {apps: [], commands: []};
					},
				),
			};
			entry = made;
			indexes.set(scope, entry);
		}
		return entry.promise;
	}
	/** The slash popup's commands: chat-input only; context-menu commands (USER 2, MESSAGE 3)
	 * have their own menus. `channelId` scopes a DM's list to that DM's bots, and is the
	 * channel-tier key for the per-command overrides in a guild. */
	async getCommands(channelId?: string) {
		const scope = this.id === "@me" ? (channelId ?? "") : "";
		const {apps, commands} = await this.commandIndex(channelId);
		this.apps = apps;
		const appOwners = this.commandIndexes?.get(scope)?.appOwners;
		const memberBits = this.id === "@me" ? undefined : this.member?.usableBits();
		return commands.filter(
			(_) => _.type === 1 && this.memberCanSee(_.rawJson, memberBits, channelId, appOwners),
		);
	}
	/** MESSAGE context-menu commands for `channelId`'s scope, synchronously: what has already
	 * been fetched (a menu can't wait). An unfetched scope starts its fetch and reads empty. */
	cachedContextCommands(channelId: string): Command[] {
		const scope = this.id === "@me" ? channelId : "";
		const entry = this.commandIndexes?.get(scope);
		const settled = entry?.settled;
		if (!settled) void this.commandIndex(channelId);
		const memberBits = this.id === "@me" ? undefined : this.member?.usableBits();
		return (settled ?? []).filter(
			(_) => _.type === 3 && this.memberCanSee(_.rawJson, memberBits, channelId, entry?.appOwners),
		);
	}
	/** Discord parity: what a member sees of the command index. Per-command overrides first
	 * (commandAllowedFor's table, after the bypasses: guild owner, ADMINISTRATOR, app owner),
	 * then a command whose default_member_permissions the member doesn't hold isn't offered
	 * (admins pass everything). Applied on every read, not at fetch, so a role granted or a
	 * member attached mid-session counts without refetching the cached index. `memberBits` is
	 * undefined for DMs and for a guild whose member isn't resolved yet (nothing to filter
	 * by), which also keeps DM lists unfiltered — the server scopes those. */
	private memberCanSee(
		raw: commandJson,
		memberBits: bigint | undefined,
		channelId?: string,
		appOwners?: Map<string, string>,
	): boolean {
		if (memberBits === undefined) return true;
		const ADMINISTRATOR = 1n << BigInt(Permissions.permisions.indexOf("ADMINISTRATOR"));
		// The owner is admin without the bit (isAdmin()'s owner branch).
		if (
			this.properties?.owner_id !== undefined &&
			this.member?.user?.id === this.properties.owner_id
		) {
			return true;
		}
		if ((memberBits & ADMINISTRATOR) === ADMINISTRATOR) return true;
		// App owner bypass (the member is the owner of the app owning the command).
		const appOwner = appOwners?.get(raw.application_id);
		if (appOwner !== undefined && this.member?.user?.id === appOwner) return true;
		// @everyone's role id is the guild id (Member's roles getter rides it the same way).
		const roleIds = new Set<string>(this.member?.roleIds ?? []);
		roleIds.add(this.id);
		const verdict = commandAllowedFor(raw.permissions, channelId, roleIds);
		if (verdict !== null) return verdict;
		// "0" — any numeric string worth 0n, the server's rule too — is Discord's admins-only;
		// null, absent or empty means everyone. Unparseable fails closed instead of crashing the list.
		if (raw.default_member_permissions && !/^\d+$/.test(raw.default_member_permissions)) return false;
		if (raw.default_member_permissions && BigInt(raw.default_member_permissions) === 0n) return false;
		const mask = BigInt(raw.default_member_permissions || "0");
		return (memberBits & mask) === mask;
	}

	async getCommandsFetch(channelId?: string) {
		// DMs ("@me") discover commands through the user index: the bots the user shares a DM
		// channel with, global commands only (the server never advertises one that can't run).
		// channel_id scopes the list to that channel's bots — a solo DM gets exactly its own
		// bot's commands instead of every bot in every DM.
		const url =
			this.id === "@me"
				? this.info.api +
					"/users/@me/application-command-index" +
					(channelId ? `?channel_id=${channelId}` : "")
				: this.info.api + `/guilds/${this.id}/application-command-index`;
		const res = await fetch(url, {
			headers: this.headers,
		});
		// A non-200 answer is an error body with neither field (or a proxy's HTML page): no
		// commands, not a crash — and `ok: false`, so the caller doesn't cache it.
		let json: {application_commands?: commandJson[]; applications?: applicationJson[]} = {};
		try {
			json = await res.json();
		} catch {
			return {ok: false, apps: [], commands: []};
		}
		// An app registering a command both globally and per-guild makes the index carry both
		// rows (global first); keep one per (app, type, name) — either id invokes — or the
		// picker offers every command twice. The type is part of the key: a user or message
		// command may share a slash command's name.
		const seen = new Set<string>();
		// The default_member_permissions filter runs at read time (memberCanSee), not here.
		const commands = (json.application_commands ?? [])
			.filter((raw) => {
				const key = raw.application_id + "/" + raw.type + "/" + raw.name;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			})
			.map((_) => new Command(_, this.localuser));
		return {
			ok: res.ok,
			apps: json.applications ?? [],
			commands,
		};
	}
}
Guild.setupcontextmenu();
export {Guild};
