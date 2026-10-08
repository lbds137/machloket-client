import {Permissions} from "./permissions.js";
import {Localuser} from "./localuser.js";
import {Guild} from "./guild.js";
import {SnowFlake} from "./snowflake.js";
import {rolesjson} from "./jsontypes.js";
import {Search} from "./search.js";
import {OptionsElement, Buttons, Dialog, ColorInput} from "./settings.js";
import {Contextmenu} from "./contextmenu.js";
import {Channel} from "./channel.js";
import {I18n} from "./i18n.js";

class Role extends SnowFlake {
	permissions: Permissions;
	owner: Guild;
	color!: number;
	name!: string;
	info: Guild["info"];
	hoist!: boolean;
	icon!: string;
	mentionable!: boolean;
	unicode_emoji!: string;
	position!: number;
	headers: Guild["headers"];
	colors?: {
		primary_color: number;
		secondary_color?: number | null;
		tertiary_color?: number | null;
	};
	constructor(json: rolesjson, owner: Guild) {
		super(json.id);

		this.headers = owner.headers;
		this.info = owner.info;
		for (const thing of Object.keys(json)) {
			if (thing === "id") {
				continue;
			}
			(this as any)[thing] = (json as any)[thing];
		}
		this.permissions = new Permissions(json.permissions);
		this.owner = owner;
		this.roleLoad();
	}
	getIcon(): HTMLElement | void {
		const hover = new Hover(this.name);
		if (this.icon) {
			const img = createImg(
				this.info.cdn +
					"/role-icons/" +
					this.id +
					"/" +
					this.icon +
					".webp" +
					new CDNParams({expectedSize: 32}),
			);
			img.classList.add("roleIcon");
			hover.addEvent(img);
			return img;
		}
		if (this.unicode_emoji) {
			const span = document.createElement("span");
			span.textContent = this.unicode_emoji;
			span.classList.add("roleIcon");
			hover.addEvent(span);
			return span;
		}
	}
	getColorStyle(short = false) {
		const grad = this.localuser.perminfo?.user?.gradientColors as boolean;
		const [len1, len2, len3] = short
			? (["", "", ""] as const)
			: (["30px", "60px", "90px"] as const);
		if (this.colors && !grad) {
			const prim = this.getColor();
			if (this.colors.secondary_color) {
				const second = Role.numberToColor(this.colors.secondary_color);
				if (this.colors.tertiary_color) {
					const third = Role.numberToColor(this.colors.tertiary_color);
					return `repeating-linear-gradient(90deg, ${prim}, ${second} ${len1}, ${third} ${len2}, ${prim} ${len3})`;
				}
				return `repeating-linear-gradient(90deg, ${prim} , ${second} ${len1}, ${prim} ${len2})`;
			}
		}
		return `linear-gradient(90deg, ${this.getColor()})`;
	}
	roleLoad() {
		const style = this.getColorStyle();
		document.documentElement.style.setProperty(`--role-${this.id}`, style);
	}
	newJson(json: rolesjson) {
		for (const thing of Object.keys(json)) {
			if (thing === "id" || thing === "permissions") {
				continue;
			}
			(this as any)[thing] = (json as any)[thing];
		}
		this.roleLoad();
		this.permissions.allow = BigInt(json.permissions);
	}
	compare(str: string) {
		function similar(str2: string | null | undefined) {
			if (!str2) return 0;
			const strl = Math.max(str.length, 1);
			if (str2.includes(str)) {
				return strl / str2.length;
			} else if (str2.toLowerCase().includes(str.toLowerCase())) {
				return strl / str2.length / 1.2;
			}
			return 0;
		}
		return Math.max(similar(this.name), similar(this.id) / 1.5);
	}
	get guild(): Guild {
		return this.owner;
	}
	get localuser(): Localuser {
		return this.guild.localuser;
	}
	static numberToColor(numb: number) {
		return `#${numb.toString(16).padStart(6, "0")}`;
	}
	getColor(): string | null {
		if (this.color === 0) {
			return null;
		}
		return Role.numberToColor(this.color);
	}
	/**
	 * > 0 when `a` ranks above `b`, as the server ranks roles: @everyone (the guild's id) lowest,
	 * then by position, equal positions by id with the older (lower) id above.
	 */
	static compare(
		guildId: string,
		a: {id: string; position: number},
		b: {id: string; position: number},
	) {
		if (a.id === b.id) return 0;
		if (a.id === guildId) return -1;
		if (b.id === guildId) return 1;
		if (a.position !== b.position) return a.position - b.position;
		return BigInt(a.id) < BigInt(b.id) ? 1 : -1;
	}
	/** Whether this member may edit, delete, grant or take this role: only below their own top role. */
	canManage() {
		const me = this.guild.member;
		if (!me.hasPermission("MANAGE_ROLES")) return false;
		if (this.guild.properties.owner_id === me.id) return true;
		return me.roles.some((r) => Role.compare(this.guild.id, r, this) > 0);
	}
}
export {Role};
import {Options} from "./settings.js";
import {createImg} from "./utils/utils.js";
import {Hover} from "./hover.js";
import {Emoji} from "./emoji.js";
import {User} from "./user.js";
import {Member} from "./member.js";
import {CDNParams} from "./utils/cdnParams.js";
class PermissionToggle implements OptionsElement<number> {
	readonly rolejson: {
		name: string;
		readableName: string;
		description: string;
	};
	permissions: Permissions;
	owner: Options;
	value!: number;
	// The rendered controls, kept so a refused save can re-class them from the shared bits.
	private permBtns?: HTMLButtonElement[];
	private permStates?: readonly number[];
	private permToggle?: HTMLButtonElement;
	constructor(roleJSON: PermissionToggle["rolejson"], permissions: Permissions, owner: Options) {
		this.rolejson = roleJSON;
		this.permissions = permissions;
		this.owner = owner;
	}
	watchForChange() {}
	generateHTML(): HTMLElement {
		const state = this.permissions.getPermission(this.rolejson.name);

		const container = document.createElement("div");
		container.classList.add("permRow");

		const labelContainer = document.createElement("div");
		labelContainer.classList.add("permLabel");

		const name = document.createElement("label");
		name.textContent = this.rolejson.readableName;
		name.classList.add("permName");
		labelContainer.append(name);

		const desc = document.createElement("div");
		desc.textContent = this.rolejson.description;
		desc.classList.add("permDesc");
		labelContainer.append(desc);

		container.append(labelContainer);

		const control = document.createElement("div");
		control.classList.add("permControl");

		if (this.permissions.hasDeny) {
			const states = [-1, 0, 1];
			const labels = ["✕", "/", "✓"];
			const classes = ["permBtn-deny", "permBtn-unset", "permBtn-allow"];
			const btns: HTMLButtonElement[] = [];
			for (let i = 0; i < 3; i++) {
				const btn = document.createElement("button");
				btn.textContent = labels[i];
				btn.classList.add("permBtn", classes[i]);
				if (state === states[i]) btn.classList.add("active");
				btn.onclick = (_) => {
					this.permissions.setPermission(this.rolejson.name, states[i]);
					btns.forEach((b) => b.classList.toggle("active", b === btn));
					this.owner.changed();
				};
				btns.push(btn);
				control.append(btn);
			}
			this.permBtns = btns;
			this.permStates = states;
			this.permToggle = undefined;
		} else {
			const toggle = document.createElement("button");
			toggle.classList.add("permSwitch");
			if (state === 1) toggle.classList.add("active");
			toggle.onclick = (_) => {
				const curState = this.permissions.getPermission(this.rolejson.name);
				const newState = curState === 1 ? 0 : 1;
				this.permissions.setPermission(this.rolejson.name, newState);
				toggle.classList.toggle("active", newState === 1);
				this.owner.changed();
			};
			const thumb = document.createElement("span");
			thumb.classList.add("permSwitchThumb");
			toggle.append(thumb);
			control.append(toggle);
			this.permToggle = toggle;
			this.permBtns = undefined;
		}

		container.append(control);

		const wrapper = document.createElement("div");
		wrapper.classList.add("permWrapper");
		wrapper.append(container);
		const divider = document.createElement("div");
		divider.classList.add("permDivider");
		wrapper.append(divider);

		return wrapper;
	}
	submit() {}

	/** Re-classes the rendered control from the shared bits (a refused save reverts them). */
	refresh() {
		const state = this.permissions.getPermission(this.rolejson.name);
		if (this.permBtns && this.permStates) {
			const states = this.permStates;
			this.permBtns.forEach((b, i) => b.classList.toggle("active", state === states[i]));
		} else if (this.permToggle) {
			this.permToggle.classList.toggle("active", state === 1);
		}
	}
}

class RoleList extends Buttons {
	permissions: [Role | User, Permissions][];
	permission: Permissions;
	readonly guild: Guild;
	readonly channel: false | Channel;
	declare buttons: [string, string][];
	readonly options: Options;
	onchange: (id: string, perms: Permissions) => boolean | Promise<boolean> | void;
	/** The permission rows this list rendered, for a refused save's re-sync. */
	permToggles: PermissionToggle[] = [];
	curid?: string;
	/** The header's "Delete Role" (guild roles only), shown only for a role one may delete. */
	deleteButton?: HTMLButtonElement;
	get info() {
		return this.guild.info;
	}
	get headers() {
		return this.guild.headers;
	}
	constructor(
		permissions: [Role | User, Permissions][],
		guild: Guild,
		onchange: (id: string, perms: Permissions) => void,
		channel: false | Channel,
	) {
		super("");
		this.guild = guild;
		this.permissions = permissions;
		this.channel = channel;
		this.onchange = onchange;
		const options = new Options("", this);
		if (channel) {
			this.permission = new Permissions("0", "0");
		} else {
			this.permission = new Permissions("0");
		}
		//TODO maybe make channels work correctly with this (role permissions aren't currently saved)
		if (!channel) {
			this.makeguildmenus(options);
		}
		for (const [catKey, permNames] of Object.entries(Permissions.categories)) {
			const catLabel = (I18n.permissions.categories as any)?.[catKey]?.() ?? catKey;
			const catOptions = options.addOptions(catLabel);
			catOptions.container.deref()?.classList.add("permGrid");
			catOptions.vsmaller = true;
			catOptions.container.deref()?.classList.add("permGrid");
			for (const permName of permNames) {
				const info = Array.from(Permissions.info()).find((_) => _.name === permName);
				if (!info) continue;
				const t = new PermissionToggle(info, this.permission, catOptions);
				catOptions.options.push(t);
				this.permToggles.push(t);
			}
		}
		if (!channel) {
			const deleteBtn = document.createElement("button");
			deleteBtn.textContent = I18n.role.delete();
			deleteBtn.classList.add("roleDeleteBtn");
			deleteBtn.onclick = () => {
				const role = this.permissions.find((_) => _[0].id === this.curid)?.[0];
				if (role) this.deleteRole(role);
			};
			options.headerActions.push(deleteBtn);
			this.deleteButton = deleteBtn;
		}
		for (const i of permissions) {
			this.buttons.push([i[0].name, i[0].id]);
		}
		this.options = options;
		guild.roleUpdate = this.groleUpdate.bind(this);
		if (channel) {
			channel.croleUpdate = this.croleUpdate.bind(this);
		}
	}
	private groleUpdate(role: Role, added: 1 | 0 | -1) {
		if (!this.channel) {
			if (added === 1) {
				this.permissions.push([role, role.permissions]);
			}
		}
		if (added === -1) {
			this.permissions = this.permissions.filter((r) => r[0] !== role);
		}
		this.redoButtons();
	}
	private croleUpdate(role: Role | User, perm: Permissions, added: boolean) {
		if (added) {
			// A row shown before it existed on the server (@everyone on a channel with no
			// overwrites) is replaced by the saved one, not doubled.
			const existing = this.permissions.findIndex((r) => r[0].id === role.id);
			if (existing === -1) this.permissions.push([role, perm]);
			else this.permissions[existing] = [role, perm];
		} else {
			this.permissions = this.permissions.filter((r) => r[0] !== role);
		}
		this.redoButtons();
	}
	makeguildmenus(option: Options) {
		option.addButtonInput("", I18n.role.displaySettings(), () => {
			const r = this.guild.roleids.get(this.curid as string);
			if (!r) return;
			const role = r;
			const form = option.addSubForm(
				I18n.role.displaySettings(),
				(e) => {
					if ("name" in e && typeof e.name === "string") {
						option.name = e.name;
					}
					option.subOptions = undefined;
					option.genTop();
				},
				{
					fetchURL: this.info.api + "/guilds/" + this.guild.id + "/roles/" + this.curid,
					method: "PATCH",
					headers: this.headers,
					traditionalSubmit: true,
				},
			);
			form.addTextInput(I18n.role.name(), "name", {
				initText: role.name,
			});
			form.addCheckboxInput(I18n.role.hoisted(), "hoist", {
				initState: role.hoist,
			});
			form.addCheckboxInput(I18n.role.mentionable(), "mentionable", {
				initState: role.mentionable,
			});
			let count: number;
			if (role.colors) {
				count = role.colors.secondary_color ? (role.colors.tertiary_color ? 3 : 2) : 1;
			} else {
				count = 1;
			}

			form.options
				.addSelect(
					I18n.role.colors.name(),
					() => {},
					(["one", "two", "three"] as const).map((_) => I18n.role.colors[_]()),
					{
						defaultIndex: count - 1,
					},
				)
				.watchForChange((_) => {
					count = _ + 1;
					colorOptGen();
				});

			const color = "#" + role.color.toString(16).padStart(6, "0");
			const colorI = form.addColorInput(I18n.role.color(), "color", {
				initColor: color,
			});

			const opt = form.addOptions("");

			const c2 =
				role.colors?.secondary_color !== undefined && role.colors?.secondary_color !== null
					? Role.numberToColor(role.colors.secondary_color)
					: color;
			const c3 =
				role.colors?.tertiary_color !== undefined && role.colors?.tertiary_color !== null
					? Role.numberToColor(role.colors.tertiary_color)
					: color;

			const colors = [color, c2, c3];

			let colorInputs: ColorInput[] = [colorI];
			function colorOptGen() {
				colorInputs = [colorInputs[0]];
				opt.removeAll();

				if (count >= 2) {
					colorInputs[1] = opt.addColorInput(I18n.role.colors.secondColor(), () => {}, {
						initColor: colors[1],
					});
					colorInputs[1].watchForChange((_) => {
						colors[1] = _;
					});
				}
				if (count === 3) {
					colorInputs[2] = opt.addColorInput(I18n.role.colors.thirdColor(), () => {}, {
						initColor: colors[2],
					});

					colorInputs[2].watchForChange((_) => {
						colors[2] = _;
					});
				}
			}
			colorOptGen();

			form.addEmojiInput(I18n.role.roleEmoji(), "unicode_emoji", this.guild.localuser, {
				initEmoji: role.unicode_emoji
					? new Emoji(
							{
								name: "Emoji",
								emoji: role.unicode_emoji,
							},
							undefined,
						)
					: undefined,
				required: false,
				clear: true,
				guild: false,
			});
			form.addImageInput(I18n.role.roleFileIcon(), "icon", {
				initImg: role.icon
					? role.info.cdn +
						"/role-icons/" +
						role.id +
						"/" +
						role.icon +
						".webp" +
						new CDNParams({expectedSize: 32})
					: "",
				clear: true,
			});
			form.addPreprocessor((obj: any) => {
				obj.color = Number("0x" + colorI.colorContent.substring(1));
				obj.permissions = this.permission.allow.toString();
				obj.colors = {
					primary_color: obj.color,
					secondary_color: colorInputs[1] ? Number("0x" + colors[1].substring(1)) : undefined,
					tertiary_color: colorInputs[2] ? Number("0x" + colors[2].substring(1)) : undefined,
				};
			});
		});
	}
	static channelrolemenu = this.ChannelRoleMenu();
	static guildrolemenu = this.GuildRoleMenu();
	private static ChannelRoleMenu() {
		const menu = new Contextmenu<RoleList, Role | User>("role settings");
		menu.addButton(
			function (user) {
				if (user instanceof User) {
					return I18n.user.remove();
				}
				return I18n.role.remove();
			},
			function (role) {
				if (!this.channel) return;
				console.log(role);
				fetch(this.info.api + "/channels/" + this.channel.id + "/permissions/" + role.id, {
					method: "DELETE",
					headers: this.headers,
				});
			},
			{
				visible: function (role) {
					//TODO, maybe this needs a check if the user is above/bellow the other user, hard to say
					return role.id !== this.guild.id;
				},
			},
		);
		menu.addButton(
			function (user) {
				if (user instanceof User) {
					return I18n.user.copyId();
				}
				return I18n.role.copyId();
			},
			function (role) {
				navigator.clipboard.writeText(role.id);
			},
		);
		return menu;
	}

	deleteRole(role: Role | User) {
		const dio = new Dialog(I18n.role.confirmDelete(role.name));
		const opt = dio.options.addOptions("", {ltr: true});
		opt.addButtonInput("", I18n.yes(), async () => {
			opt.removeAll();
			opt.addText(I18n.role.deleting());
			const status = await fetch(role.info.api + "/guilds/" + this.guild.id + "/roles/" + role.id, {
				method: "DELETE",
				headers: this.guild.headers,
			}).then(
				(res) => (res.ok ? undefined : "HTTP " + res.status),
				() => "offline",
			);
			if (status) {
				// Refused (e.g. a role above one's own): the role stays, and so does the view.
				opt.removeAll();
				opt.addText(I18n.requestFailed(status));
				opt.addButtonInput("", I18n.ok(), () => dio.hide());
				return;
			}
			if (this.curid === role.id) {
				const id = this.permissions.filter((_) => _[0].id !== role.id)[0][0].id;
				const elm = this.htmlarea.deref();
				if (elm) this.generateHTMLArea(id, elm);
			}
			dio.hide();
		});
		opt.addButtonInput("", I18n.no(), () => {
			dio.hide();
		});
		dio.show();
	}
	private static GuildRoleMenu() {
		const menu = new Contextmenu<RoleList, Role>("role settings");
		menu.addButton(
			() => I18n.role.delete(),
			function (role) {
				this.deleteRole(role);
			},
			{
				visible: (role) => role.id !== role.guild.id,
			},
		);
		menu.addButton(
			function (user) {
				if (user instanceof User) {
					return I18n.user.copyId();
				}
				return I18n.role.copyId();
			},
			function (role) {
				navigator.clipboard.writeText(role.id);
			},
		);
		return menu;
	}
	redoButtons() {
		this.buttons = [];
		this.permissions.sort(([a], [b]) => {
			if (b instanceof User) return 1;
			if (a instanceof User) return -1;
			return b.position - a.position;
		});
		for (const i of this.permissions) {
			this.buttons.push([i[0].name, i[0].id]);
		}
		if (!this.buttonList) return;
		const elms = Array.from(this.buttonList.children);
		const div = elms[0] as HTMLDivElement;
		const div2 = elms[1] as HTMLDivElement;
		console.log(div);
		div.innerHTML = "";
		div.append(this.buttonListGen(div2)); //not actually sure why the html is needed
	}
	buttonRoleMap = new WeakMap<HTMLButtonElement, Role>();
	dragged?: HTMLButtonElement;
	buttonDragEvents(button: HTMLButtonElement, role: Role) {
		const height = 35;
		this.buttonRoleMap.set(button, role);
		button.addEventListener("dragstart", (e) => {
			this.dragged = button;
			e.stopImmediatePropagation();
		});

		button.addEventListener("dragend", () => {
			this.dragged = undefined;
		});

		button.addEventListener("dragenter", (event) => {
			event.preventDefault();
			return true;
		});

		button.addEventListener("dragover", (event) => {
			event.preventDefault();
			if (event.offsetY / height < 0.5) {
				button.classList.add("dragTopView");
				button.classList.remove("dragBottomView");
			} else {
				button.classList.remove("dragTopView");
				button.classList.add("dragBottomView");
			}
			return true;
		});
		button.addEventListener("dragleave", () => {
			button.classList.remove("dragTopView");
			button.classList.remove("dragBottomView");
		});

		button.addEventListener("drop", (event) => {
			const role2 = this.buttonRoleMap.get(this.dragged as HTMLButtonElement);
			if (!role2 || this.dragged === button) return;
			const index2 = this.guild.roles.indexOf(role2);
			this.guild.roles.splice(index2, 1);
			const index = this.guild.roles.indexOf(role);
			if (event.offsetY / height < 0.5) {
				this.guild.roles.splice(index, 0, role2);
			} else {
				this.guild.roles.splice(index + 1, 0, role2);
			}

			this.guild.recalcRoles();
			console.log(role);
		});
	}
	buttonListGen(html: HTMLElement) {
		const buttonTable = document.createElement("div");
		buttonTable.classList.add("flexttb");

		const roleRow = document.createElement("div");
		roleRow.classList.add("flexltr", "rolesheader");
		roleRow.append(this.channel ? I18n.role.perms() : I18n.role.roles());
		const add = document.createElement("span");
		add.classList.add("svg-plus", "svgicon", "addrole");

		add.onclick = async (e) => {
			const box = add.getBoundingClientRect();
			e.stopPropagation();
			if (this.channel) {
				const roles: [Role, string[]][] = [];
				for (const role of this.guild.roles) {
					if (this.permissions.find((r) => r[0] == role)) {
						continue;
					}
					roles.push([role, [role.name]]);
				}
				const search = new Search<Role | User>(roles, async (str) => {
					const users = (await this.guild.searchMembers(3, str))
						.map((_) => _.user)
						.map((_) => [_.name, _] as [string, User]);
					console.log(users);
					return users;
				});

				const found = await search.find(box.left, box.top);

				if (!found) return;
				console.log(found);
				this.onchange(found.id, new Permissions("0", "0"));
			} else {
				const div = document.createElement("div");
				const bar = document.createElement("input");
				div.classList.add("fixedsearch", "OptionList");
				bar.type = "text";
				div.style.left = (box.left ^ 0) + "px";
				div.style.top = (box.top ^ 0) + "px";
				div.append(bar);
				document.body.append(div);
				Contextmenu.declareMenu(div);
				Contextmenu.keepOnScreen(div);
				bar.onchange = () => {
					div.remove();
					console.log(bar.value);
					if (bar.value === "") return;
					fetch(this.info.api + `/guilds/${this.guild.id}/roles`, {
						method: "POST",
						headers: this.headers,
						body: JSON.stringify({
							color: 0,
							name: bar.value,
							permissions: "",
						}),
					});
				};
			}
		};
		roleRow.append(add);

		buttonTable.append(roleRow);
		for (const thing of this.buttons) {
			const button = document.createElement("button");

			this.buttonMap.set(thing[0], button);
			button.classList.add("SettingsButton");
			const span = document.createElement("span");
			span.textContent = thing[0];
			button.append(span);
			span.classList.add("roleButtonStyle");
			const role = this.guild.roleids.get(thing[1]) || this.guild.localuser.userMap.get(thing[1]);
			if (role) {
				if (role instanceof Role) {
					if (role.getColor()) button.style.setProperty("--user-bg", `var(--role-${role.id})`);
				} else {
					Member.resolveMember(role, this.guild).then((_) => {
						if (!_) return;
						const style = _.getColorStyle();
						if (style) button.style.setProperty("--user-bg", style);
					});
				}
				if (!this.channel) {
					if (role instanceof Role && role.canManage()) {
						this.buttonDragEvents(button, role);
						button.draggable = true;
						RoleList.guildrolemenu.bindContextmenu(button, this, role);
					}
				} else {
					// A channel overwrite has no role-hierarchy rule on the server, only MANAGE_ROLES
					// in that channel.
					if (role instanceof User || this.channel.hasPermission("MANAGE_ROLES")) {
						RoleList.channelrolemenu.bindContextmenu(button, this, role);
					}
				}
			}
			button.onclick = (_) => {
				this.generateHTMLArea(thing[1], html);
				if (this.warndiv) {
					this.warndiv.remove();
				}
				if (window.innerWidth <= 1012) {
					button.closest(".settingbuttons")?.classList.add("mobileHidden");
					html.classList.remove("mobileHidden");
					const settingsPanel = button.closest(".background");
					const backBtn = settingsPanel?.querySelector(".settingsback") as HTMLElement;
					if (backBtn) backBtn.style.display = "";
				}
			};
			buttonTable.append(button);
		}
		return buttonTable;
	}

	generateButtons(html: HTMLElement): HTMLDivElement {
		const div = document.createElement("div");
		div.classList.add("settingbuttons");
		div.append(this.buttonListGen(html));
		return div;
	}
	handleString(str: string): HTMLElement {
		this.curid = str;
		const arr = this.permissions.find((_) => _[0].id === str);
		if (arr) {
			const perm = arr[1];
			this.permission.deny = perm.deny;
			this.permission.allow = perm.allow;
			const role = this.permissions.find((e) => e[0].id === str);
			if (role) {
				this.options.name = role[0].name;
				this.options.haschanged = false;
			}
		}
		if (this.deleteButton) {
			const role = arr?.[0];
			this.deleteButton.hidden = !(
				role instanceof Role &&
				role.id !== this.guild.id &&
				role.canManage()
			);
		}
		this.options.subOptions = undefined;
		return this.options.generateHTML();
	}
	async save() {
		if (this.options.subOptions || !this.curid) return;
		const sentAllow = this.permission.allow;
		const sentDeny = this.permission.deny;
		const ok = await this.onchange(this.curid, this.permission);
		if (ok !== false) return;
		// Flips made while the save was in flight are newer than the refusal; only an
		// untouched editor goes back to the stored bits.
		if (this.permission.allow !== sentAllow || this.permission.deny !== sentDeny) return;
		this.refusedSave();
	}

	/** A refused save: the editor was showing the refused bits; back to the stored ones. */
	private refusedSave() {
		const arr = this.permissions.find((_) => _[0].id === this.curid);
		if (!arr) return;
		this.permission.allow = arr[1].allow;
		this.permission.deny = arr[1].deny;
		this.options.haschanged = false;
		for (const t of this.permToggles) t.refresh();
	}
}
export {RoleList, PermissionToggle};
