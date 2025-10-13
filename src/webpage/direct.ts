import {Guild} from "./guild.js";
import {Channel} from "./channel.js";
import {Message} from "./message.js";
import {Localuser} from "./localuser.js";
import {User} from "./user.js";
import {channeljson, dirrectjson, memberjson, readyjson} from "./jsontypes.js";
import {Permissions} from "./permissions.js";
import {SnowFlake} from "./snowflake.js";
import {Contextmenu} from "./contextmenu.js";
import {I18n} from "./i18n.js";
import {Dialog, Float, FormError} from "./settings.js";

class Direct extends Guild {
	channels: Group[];
	getUnixTime(): number {
		throw new Error("Do not call this for Direct, it does not make sense");
	}
	constructor(json: dirrectjson[], owner: Localuser) {
		super(-1, owner, null);
		this.message_notifications = 0;
		this.channels = [];
		// @ts-ignore it's a hack, but it's a hack that works
		this.properties = {};
		this.roles = [];
		this.roleids = new Map();
		this.prevchannel = undefined;
		this.properties.name = I18n.getTranslation("DMs.name");
		for (const thing of json) {
			const temp = new Group(thing, this);
			this.channels.push(temp);
			this.localuser.channelids.set(temp.id, temp);
		}
		this.headchannels = this.channels;
	}
	createChannelpac(json: any) {
		const thischannel = new Group(json, this);
		this.channels.push(thischannel);
		this.localuser.channelids.set(thischannel.id, thischannel);
		this.sortchannels();
		this.printServers();
		return thischannel;
	}
	delChannel(json: channeljson) {
		const channel = this.localuser.channelids.get(json.id) as Group;
		super.delChannel(json);
		if (channel) {
			channel.del();
		}
	}
	freindDiv?: HTMLDivElement;
	getHTML() {
		const voiceArea = document.getElementById("voiceArea") as HTMLElement;
		voiceArea.innerHTML = "";
		const sideContainDiv = document.getElementById("sideContainDiv");
		if (sideContainDiv) {
			sideContainDiv.classList.remove("searchDiv");
			sideContainDiv.classList.remove("hideSearchDiv");
		}
		const searchBox = document.getElementById("searchBox");
		if (searchBox) searchBox.textContent = "";

		const ddiv = document.createElement("div");
		const build = super.getHTML();
		const freindDiv = document.createElement("div");
		freindDiv.classList.add("liststyle", "flexltr", "friendsbutton");

		const icon = document.createElement("span");
		icon.classList.add("svgicon", "svg-friends", "space");
		freindDiv.append(icon);
		this.freindDiv = freindDiv;

		freindDiv.append(I18n.friends.friends());
		freindDiv.onclick = () => {
			this.loadChannel(null);
		};

		const newDm = document.createElement("div");
		newDm.classList.add("flexltr", "dmline");
		newDm.onclick = () => this.makeGroup();

		const span = document.createElement("span");
		span.classList.add("svg-plus", "svgicon", "addchannel");

		newDm.append(I18n.dms(), span);

		ddiv.append(freindDiv, newDm, build);
		return ddiv;
	}
	makeGroup() {
		const dio = new Dialog(I18n.group.select());
		const opt = dio.options;

		const div = document.createElement("div");
		div.classList.add("flexttb", "friendGroupSelect");
		const friends = [...this.localuser.inrelation].filter((_) => _.relationshipType === 1);

		const invited = new Set<User>();

		const makeList = (search: string) => {
			const list = friends
				.map((friend) => [friend, friend.compare(search)] as const)
				.filter((_) => _[1] !== 0)
				.sort((a, b) => a[1] - b[1])
				.map((_) => _[0]);
			div.innerHTML = "";
			div.append(
				...list.map((friend) => {
					const div = document.createElement("div");
					div.classList.add("flexltr");
					const check = document.createElement("input");
					check.type = "checkbox";
					check.checked = invited.has(friend);
					check.onchange = () => {
						if (check.checked) {
							invited.add(friend);
						} else {
							invited.delete(friend);
						}
					};
					//TODO implement status stuff here once spacebar really supports it
					div.append(friend.buildpfp(), friend.name, check);
					return div;
				}),
			);
		};
		opt.addTextInput("", () => {}).onchange = makeList;
		opt.addHTMLArea(div);
		const buttons = opt.addOptions("", {ltr: true});
		buttons.addButtonInput("", I18n.cancel(), () => {
			dio.hide();
		});
		buttons.addButtonInput("", I18n.group.createdm(), async () => {
			if (invited.size !== 0) {
				const {id}: {id: string} = await (
					await fetch(this.info.api + "/users/@me/channels", {
						method: "POST",
						headers: this.headers,
						body: JSON.stringify({
							recipients: [...invited].map((_) => _.id),
						}),
					})
				).json();
				this.localuser.goToChannel(id);
				dio.hide();
			}
		});

		makeList("");
		dio.show();
		buttons.container.deref()?.classList.add("expandButtons");
	}
	noChannel(addstate: boolean) {
		if (addstate) {
			history.pushState([this.id, undefined], "", "/channels/" + this.id);
		}
		if (this.freindDiv) {
			this.freindDiv.classList.add("viewChannel");
		}
		this.localuser.pageTitle(I18n.getTranslation("friends.friendlist"));
		const channelTopic = document.getElementById("channelTopic") as HTMLSpanElement;
		channelTopic.removeAttribute("hidden");
		channelTopic.textContent = "";
		channelTopic.onclick = () => {};

		const loading = document.getElementById("loadingdiv") as HTMLDivElement;
		loading.classList.remove("loading");
		this.localuser.getSidePannel();

		const messages = document.getElementById("scrollWrap") as HTMLDivElement;
		for (const thing of Array.from(messages.getElementsByClassName("messagecontainer"))) {
			thing.remove();
		}
		const container = document.createElement("div");
		container.classList.add("messagecontainer", "flexttb", "friendcontainer");

		messages.append(container);
		const checkVoid = () => {
			if (this.localuser.channelfocus !== undefined || this.localuser.lookingguild !== this) {
				this.localuser.relationshipsUpdate = () => {};
			}
		};
		function genuserstrip(user: User, icons: HTMLElement): HTMLElement {
			const div = document.createElement("div");
			div.classList.add("flexltr", "liststyle");
			user.bind(div);
			div.append(user.buildpfp(undefined, div));

			const userinfos = document.createElement("div");
			userinfos.classList.add("flexttb");
			const username = document.createElement("span");
			username.textContent = user.name;
			userinfos.append(username, user.getStatus());
			div.append(userinfos);
			User.contextmenu.bindContextmenu(div, user, undefined);
			userinfos.style.flexGrow = "1";

			div.append(icons);
			return div;
		}
		{
			//TODO update on users coming online
			const online = document.createElement("button");
			online.textContent = I18n.getTranslation("friends.online");
			channelTopic.append(online);
			const genOnline = () => {
				this.localuser.relationshipsUpdate = genOnline;
				checkVoid();
				container.innerHTML = "";
				container.append(I18n.getTranslation("friends.online:"));
				for (const user of this.localuser.inrelation) {
					if (user.relationshipType === 1 && user.online) {
						const buttonc = document.createElement("div");
						const button1 = document.createElement("span");
						button1.classList.add("svg-frmessage", "svgicon");
						buttonc.append(button1);
						buttonc.classList.add("friendlyButton");
						buttonc.onclick = (e) => {
							e.stopImmediatePropagation();
							user.opendm();
						};
						container.append(genuserstrip(user, buttonc));
					}
				}
			};
			online.onclick = genOnline;
			genOnline();
		}
		{
			const all = document.createElement("button");
			all.textContent = I18n.getTranslation("friends.all");
			const genAll = () => {
				this.localuser.relationshipsUpdate = genAll;
				checkVoid();
				container.innerHTML = "";
				container.append(I18n.getTranslation("friends.all:"));
				for (const user of this.localuser.inrelation) {
					if (user.relationshipType === 1) {
						const buttonc = document.createElement("div");
						const button1 = document.createElement("span");
						button1.classList.add("svg-frmessage", "svgicon");
						buttonc.append(button1);
						buttonc.classList.add("friendlyButton");
						buttonc.onclick = (e) => {
							e.stopImmediatePropagation();
							user.opendm();
						};
						container.append(genuserstrip(user, buttonc));
					}
				}
			};
			all.onclick = genAll;
			channelTopic.append(all);
		}
		{
			const pending = document.createElement("button");
			pending.textContent = I18n.getTranslation("friends.pending");
			const genPending = () => {
				this.localuser.relationshipsUpdate = genPending;
				checkVoid();
				container.innerHTML = "";
				container.append(I18n.getTranslation("friends.pending:"));
				for (const user of this.localuser.inrelation) {
					if (user.relationshipType === 3 || user.relationshipType === 4) {
						const buttons = document.createElement("div");
						buttons.classList.add("flexltr");
						const buttonc = document.createElement("div");
						const button1 = document.createElement("span");
						button1.classList.add("svgicon", "svg-x");
						if (user.relationshipType === 3) {
							const buttonc = document.createElement("div");
							const button2 = document.createElement("span");
							button2.classList.add("svgicon", "svg-x");
							button2.classList.add("svg-addfriend");
							buttonc.append(button2);
							buttonc.classList.add("friendlyButton");
							buttonc.append(button2);
							buttons.append(buttonc);
							buttonc.onclick = (e) => {
								e.stopImmediatePropagation();
								user.changeRelationship(1);
								outerDiv.remove();
							};
						}
						buttonc.append(button1);
						buttonc.classList.add("friendlyButton");
						buttonc.onclick = (e) => {
							e.stopImmediatePropagation();
							user.changeRelationship(0);
							outerDiv.remove();
						};
						buttons.append(buttonc);
						const outerDiv = genuserstrip(user, buttons);
						container.append(outerDiv);
					}
				}
			};
			pending.onclick = genPending;
			channelTopic.append(pending);
		}
		{
			const blocked = document.createElement("button");
			blocked.textContent = I18n.getTranslation("friends.blocked");

			const genBlocked = () => {
				this.localuser.relationshipsUpdate = genBlocked;
				checkVoid();
				container.innerHTML = "";
				container.append(I18n.getTranslation("friends.blockedusers"));
				for (const user of this.localuser.inrelation) {
					if (user.relationshipType === 2) {
						const buttonc = document.createElement("div");
						const button1 = document.createElement("span");
						button1.classList.add("svg-x", "svgicon");
						buttonc.append(button1);
						buttonc.classList.add("friendlyButton");
						buttonc.onclick = (e) => {
							user.changeRelationship(0);
							e.stopImmediatePropagation();
							outerDiv.remove();
						};
						const outerDiv = genuserstrip(user, buttonc);
						container.append(outerDiv);
					}
				}
			};
			blocked.onclick = genBlocked;
			channelTopic.append(blocked);
		}
		{
			const add = document.createElement("button");
			add.textContent = I18n.getTranslation("friends.addfriend");
			add.onclick = () => {
				this.localuser.relationshipsUpdate = () => {};
				container.innerHTML = "";
				const float = new Float("");
				const options = float.options;
				const form = options.addForm(
					"",
					(e: any) => {
						console.log(e);
						if (e.code === 404) {
							throw new FormError(text, I18n.getTranslation("friends.notfound"));
						} else if (e.code === 400) {
							throw new FormError(text, e.message.split("Error: ")[1]);
						} else {
							const box = text.input.deref();
							if (!box) return;
							box.value = "";
						}
					},
					{
						method: "POST",
						fetchURL: this.info.api + "/users/@me/relationships",
						headers: this.headers,
					},
				);
				const text = form.addTextInput(I18n.getTranslation("friends.addfriendpromt"), "username");
				form.addPreprocessor((obj: any) => {
					const [username, discriminator] = obj.username.split("#");
					obj.username = username;
					obj.discriminator = discriminator;
					if (!discriminator) {
						throw new FormError(text, I18n.getTranslation("friends.discnotfound"));
					}
				});
				container.append(float.generateHTML());
			};
			channelTopic.append(add);
		}
	}
	get mentions() {
		let mentions = 0;
		for (const thing of this.localuser.inrelation) {
			if (thing.relationshipType === 3) {
				mentions += 1;
			}
		}
		return mentions;
	}
	giveMember(_member: memberjson) {
		throw new Error("not a real guild, can't give member object");
	}
	getRole() {
		return null;
	}
	hasRole() {
		return false;
	}
	isAdmin() {
		return false;
	}
	unreaddms() {
		for (const thing of this.channels) {
			(thing as Group).unreads();
		}
	}
}

const dmPermissions = new Permissions("0");
dmPermissions.setPermission("ADD_REACTIONS", 1);
dmPermissions.setPermission("VIEW_CHANNEL", 1);
dmPermissions.setPermission("SEND_MESSAGES", 1);
dmPermissions.setPermission("EMBED_LINKS", 1);
dmPermissions.setPermission("ATTACH_FILES", 1);
dmPermissions.setPermission("READ_MESSAGE_HISTORY", 1);
dmPermissions.setPermission("MENTION_EVERYONE", 1);
dmPermissions.setPermission("USE_EXTERNAL_EMOJIS", 1);
dmPermissions.setPermission("USE_APPLICATION_COMMANDS", 1);
dmPermissions.setPermission("USE_EXTERNAL_STICKERS", 1);
dmPermissions.setPermission("USE_EMBEDDED_ACTIVITIES", 1);
dmPermissions.setPermission("USE_SOUNDBOARD", 1);
dmPermissions.setPermission("USE_EXTERNAL_SOUNDS", 1);
dmPermissions.setPermission("SEND_VOICE_MESSAGES", 1);
dmPermissions.setPermission("SEND_POLLS", 1);
dmPermissions.setPermission("USE_EXTERNAL_APPS", 1);

dmPermissions.setPermission("CONNECT", 1);
dmPermissions.setPermission("SPEAK", 1);
dmPermissions.setPermission("STREAM", 1);
dmPermissions.setPermission("USE_VAD", 1);
class Group extends Channel {
	users: User[];
	static contextmenu = new Contextmenu<Group, undefined>("channel menu");
	static setupcontextmenu() {
		this.contextmenu.addButton(
			() => I18n.getTranslation("DMs.markRead"),
			function (this: Group) {
				this.readbottom();
			},
		);

		this.contextmenu.addSeperator();

		this.contextmenu.addButton(
			() => I18n.group.edit(),
			function () {
				this.edit();
			},
			{
				visable: function () {
					return this.users.length !== 1;
				},
			},
		);

		this.contextmenu.addButton(
			() => I18n.getTranslation("DMs.close"),
			function (this: Group) {
				this.deleteChannel();
			},
			{
				color: "red",
			},
		);

		this.contextmenu.addSeperator();

		this.contextmenu.addButton(
			() => I18n.user.copyId(),
			function () {
				navigator.clipboard.writeText(this.users[0].id);
			},
			{
				visable: function () {
					return this.users.length === 1;
				},
			},
		);

		this.contextmenu.addButton(
			() => I18n.getTranslation("DMs.copyId"),
			function (this: Group) {
				navigator.clipboard.writeText(this.id);
			},
		);
	}
	iconUrl() {
		return `${this.info.cdn}/channel-icons/${this.id}/${this.icon}.png`;
	}
	icon?: string;
	edit() {
		const dio = new Dialog(I18n.group.edit());
		const form = dio.options.addForm("", () => {}, {
			fetchURL: this.info.api + "/channels/" + this.id,
			headers: this.headers,
			method: "PATCH",
		});
		form.addTextInput(I18n.channel["name:"](), "name", {
			initText: this.name === this.defaultName() ? "" : this.name,
		});
		form.addImageInput(I18n.channel.icon(), "icon", {
			initImg: this.icon ? this.iconUrl() : undefined,
		});
		dio.show();
	}
	defaultName() {
		return this.users.map((_) => _.name).join(", ");
	}
	constructor(json: dirrectjson, owner: Direct) {
		super(-1, owner, json.id);

		this.icon = json.icon;

		const userSet = new Set(json.recipients.map((user) => new User(user, this.localuser)));

		this.users = [...userSet];
		this.name = json.name || this.defaultName();

		userSet.add(this.localuser.user);

		this.name ??= this.localuser.user.username;
		this.parent_id!;
		this.parent!;
		this.children = [];
		this.guild_id = "@me";
		this.permission_overwrites = new Map();
		if (json.last_message_id) {
			this.lastmessageid = json.last_message_id;
		} else {
			this.lastmessageid = undefined;
		}
		this.mentions = 0;

		this.setUpInfiniteScroller();
		this.updatePosition();
	}
	updatePosition() {
		//TODO see if fake messages break this
		if (this.lastmessageid) {
			this.position = SnowFlake.stringToUnixTime(this.lastmessageid);
		} else {
			this.position = 0;
		}
		this.position = -Math.max(this.position, this.getUnixTime());
	}
	createguildHTML() {
		const div = document.createElement("div");
		Group.contextmenu.bindContextmenu(div, this, undefined);
		this.html = new WeakRef(div);
		div.classList.add("flexltr", "liststyle");
		const myhtml = document.createElement("span");
		myhtml.classList.add("ellipsis");
		myhtml.textContent = this.name;

		div.appendChild(this.makeIcon());

		div.appendChild(myhtml);
		(div as any).myinfo = this;
		div.onclick = (_) => {
			this.getHTML();
			const toggle = document.getElementById("maintoggle") as HTMLInputElement;
			toggle.checked = true;
		};

		return div;
	}
	getname() {
		return this.name;
	}
	notititle(message: Message) {
		if (this.users.length === 1) {
			return message.author.username;
		} else {
			return this.getname() + " > " + message.author.username;
		}
	}
	readStateInfo(json: readyjson["d"]["read_state"]["entries"][0]): void {
		super.readStateInfo(json);
		if (this.lastmessageid !== this.lastreadmessageid && this.mentions === 0) {
			this.mentions++;
		}
	}
	readbottom() {
		super.readbottom();
		this.unreads();
	}
	all: WeakRef<HTMLElement> = new WeakRef(document.createElement("div"));
	noti?: WeakRef<HTMLElement>;
	del() {
		const all = this.all.deref();
		if (all) {
			all.remove();
		}
		if (this.myhtml) {
			this.myhtml.remove();
		}
	}
	makeIcon(): HTMLElement {
		if (this.users.length === 1) {
			return this.users[0].buildpfp(undefined);
		} else {
			const div = document.createElement("div");
			div.classList.add("groupDmDiv");
			for (const user of this.users.slice(0, 5)) {
				div.append(user.buildpfp(undefined));
			}
			return div;
		}
	}
	unreads() {
		const sentdms = document.getElementById("sentdms") as HTMLDivElement; //Need to change sometime
		const current = this.all.deref();
		if (this.hasunreads) {
			{
				const noti = this.noti?.deref();
				if (noti) {
					noti.textContent = this.mentions + "";
					return;
				}
			}
			const div = document.createElement("div");
			div.classList.add("servernoti");
			const noti = document.createElement("div");
			noti.classList.add("unread", "notiunread", "pinged");
			noti.textContent = "" + this.mentions;
			this.noti = new WeakRef(noti);
			const buildpfp = this.makeIcon();
			this.all = new WeakRef(div);
			buildpfp.classList.add("mentioned");
			div.append(buildpfp, noti);
			sentdms.append(div);
			div.onclick = (_) => {
				this.guild.loadGuild();
				this.getHTML();
				const toggle = document.getElementById("maintoggle") as HTMLInputElement;
				toggle.checked = true;
			};
		} else if (current) {
			current.remove();
		} else {
		}
	}

	hasPermission(name: string): boolean {
		return dmPermissions.hasPermission(name);
	}
}
export {Direct, Group};

Group.setupcontextmenu();
