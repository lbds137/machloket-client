import {Channel} from "../channel.js";
import {Guild} from "../guild.js";
import {I18n} from "../i18n.js";
import {commandJson, commandOptionJson} from "../jsontypes.js";
import {Localuser} from "../localuser.js";
import {SnowFlake} from "../snowflake.js";
import {wireGuildId} from "./compontents.js";
import {removeAni} from "../utils/utils.js";
function focusInput(html: HTMLElement) {
	const input = html.getElementsByTagName("input")[0];
	if (input) input.focus();
}
function focusElm(node: HTMLElement | Text, before = true) {
	const selection = window.getSelection();
	if (!selection) return;
	var range = document.createRange();
	if (before) {
		range.setStartBefore(node);
	} else {
		range.setStartAfter(node);
	}
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
}
export class Command extends SnowFlake {
	owner: Localuser | Guild;
	type: 1 | 2 | 3 | 4;
	applicationId: string;
	name: string;
	nameLocalizations: Record<string, string>;
	descriptionLocalizations: Record<string, string>;
	description: string;
	defaultMemberPerms: BigInt;
	permissions: {
		user: boolean;
		roles: Record<string, boolean>;
		channels: Record<string, boolean>;
	};
	nsfw: boolean;
	gpr: number;
	version: string;
	handler: 1 | 2 | 3;
	options: Option[];
	readonly rawJson: Readonly<commandJson>;
	get localuser() {
		if (this.owner instanceof Localuser) {
			return this.owner;
		} else {
			return this.owner.owner;
		}
	}
	constructor(command: commandJson, owner: Localuser | Guild) {
		super(command.id);
		this.rawJson = Object.freeze(structuredClone(command));
		this.owner = owner;
		this.type = command.type;
		this.applicationId = command.application_id;
		this.name = command.name;
		this.nameLocalizations = command.name_localizations || {};
		this.description = command.description;
		this.descriptionLocalizations = command.description_localizations || {};
		this.defaultMemberPerms = BigInt(command.default_member_permissions || "0");
		this.permissions = {
			user: command.permissions?.user || true,
			roles: command.permissions?.roles || {},
			channels: command.permissions?.channels || {},
		};
		command.options ||= [];
		this.options = command.options.map((_) => Option.toOption(_, this));
		this.nsfw = command.nsfw;
		this.gpr = command.global_popularity_rank || 0;
		this.version = command.version;
		this.handler = command.handler || 1;
	}
	get localizedName() {
		return this.nameLocalizations[I18n.lang] || this.name;
	}
	get localizedDescription() {
		return this.descriptionLocalizations[I18n.lang] || this.description;
	}
	similar(search: string) {
		if (search.length === 0) {
			return 0.1;
		}
		const similar = (str: string) => {
			if (str.includes(search)) {
				return search.length / str.length;
			} else if (str.toLowerCase().includes(search.toLowerCase())) {
				return str.length / str.length / 1.4;
			} else {
				return 0;
			}
		};
		return Math.max(
			similar(this.name),
			similar(this.description),
			similar(this.localizedDescription),
			similar(this.localizedName),
		);
	}
	state = new WeakMap<
		Channel,
		(
			| {
					option: Option;
					state: string;
			  }
			| string
		)[]
	>();
	collect(html: HTMLElement, channel: Channel, node?: Node): boolean {
		const states = this.state.get(channel);
		const build: (
			| {
					option: Option;
					state: string;
			  }
			| string
		)[] = [];
		if (!states) return false;

		let gotname = false;
		for (const elm of Array.from(html.childNodes)) {
			if (elm instanceof HTMLElement) {
				if (elm.classList.contains("commandFront")) {
					gotname = true;
					continue;
				}
				const name = elm.getAttribute("commandName");
				const state = states.find((_) => _ instanceof Object && _.option.match(name || ""));
				if (state) {
					build.push(state);
				} else {
					// A branch's leaf options are chips of this command too — collect must know
					// them or their inputs can never record values.
					const branchLeaves = this.options.flatMap((branch) =>
						branch instanceof SubCommandOption ? branch.allLeaves() : [],
					);
					const option =
						this.options.find((_) => _.match(name || "")) ??
						branchLeaves.find((_) => _.match(name || ""));
					if (option) {
						build.push({option, state: ""});
					}
				}
			} else if (elm instanceof Text) {
				build.push(elm.textContent || "");
			}
		}

		if (node instanceof Text) {
			this.searchAtr(node, channel, html);
		}

		if (gotname) {
			this.state.set(channel, build);
		} else {
			this.state.delete(channel);
		}

		return gotname;
	}
	searchAtr(textNode: Text, channel: Channel, Divhtml: HTMLElement) {
		const text = (textNode.textContent || "").trim();
		const states = this.state.get(channel);
		if (!states) {
			this.localuser.MDSearchOptions(
				[],
				"",
				document.getElementById("searchOptions") as HTMLDivElement,
			);
			return;
		}
		const opts = this.options
			.filter(
				(obj) =>
					// Branches are the branch picker's business, not insertable arguments.
					!(obj instanceof SubCommandOption) &&
					!states.find((_) => _ instanceof Object && _.option === obj),
			)
			.map((opt) => [opt, opt.similar(text)] as const)
			.filter((_) => _[1])
			.sort((a, b) => a[1] - b[1])
			.slice(0, 6)
			.map((_) => _[0]);
		this.localuser.MDSearchOptions(
			opts.map((opt) => {
				return [
					opt.localizedName,
					"",
					void 0,
					() => {
						const html = opt.toHTML("", channel);
						textNode.after(html);
						textNode.remove();
						this.collect(Divhtml, channel);
						console.log(this.state.get(channel));
						focusInput(html);
						return true;
					},
				];
			}),
			"",
			document.getElementById("searchOptions") as HTMLDivElement,
		);
	}
	render(html: HTMLElement, channel: Channel) {
		console.warn(this.rawJson);
		html.innerHTML = "";
		let state = this.state.get(channel);
		if (!state) {
			// A command made of subcommands/groups seeds one branch picker instead of every
			// leaf; the picked branch brings its own. Otherwise every option seeds — an empty
			// optional is omitted at submit — so there is always an input to type into.
			const branches = this.options.filter((_) => _ instanceof SubCommandOption);
			const req =
				branches.length && branches.length === this.options.length
					? [branches[0]]
					: this.options.filter((_) => !(_ instanceof SubCommandOption));
			state = req.map((option) => ({option, state: ""}));
			this.state.set(channel, state);
		}
		const command = document.createElement("span");
		command.classList.add("commandFront");
		command.textContent = `/${this.localizedName}`;
		command.contentEditable = "false";
		html.append(command);
		let lastElm: HTMLElement | undefined = undefined;
		let firstFocus: HTMLElement | undefined = undefined;
		for (const thing of state) {
			if (typeof thing === "string") {
				html.append(thing);
				continue;
			}
			const {option, state} = thing;
			const opt = option.toHTML(state, channel);
			if (!firstFocus && (option.required || option instanceof SubCommandOption)) {
				firstFocus = opt;
			}
			lastElm = opt;
			html.append(opt);
		}
		if (firstFocus ?? lastElm) {
			// The first required option (or the branch picker) is where typing should land.
			focusInput((firstFocus ?? lastElm)!);
		} else {
			const node = new Text();
			node.textContent = "";
			html.append(node);
			focusElm(node, false);
		}
	}
	stateChange(option: Option, channel: Channel, state: string) {
		const states = this.state.get(channel);
		if (!states) return;
		const stateObj = states.find((_) => _ instanceof Object && _.option === option);
		if (stateObj && stateObj instanceof Object) {
			stateObj.state = state;
		}
	}
	getState(option: Option, channel: Channel) {
		const states = this.state.get(channel);
		if (!states) return;
		const stateObj = states.find((_) => _ instanceof Object && _.option === option);
		if (stateObj && stateObj instanceof Object) {
			return stateObj.state;
		}
		return;
	}
	get info() {
		return this.owner.info;
	}

	get headers() {
		return this.owner.headers;
	}

	async submit(html: HTMLElement, channel: Channel) {
		try {
			const nonce = Math.floor(Math.random() * 10 ** 9) + "";
			this.localuser.registerCommandNonce(nonce, channel);
			const states = this.state.get(channel);
			if (!states) {
				return true;
			}
			const opts = states.filter((_) => typeof _ !== "string");
			// A subcommand/group command nests: the picked branch carries the leaf entries.
			const branch = opts.find(
				(_) => _.option instanceof SubCommandOption,
			) as {option: SubCommandOption; state: string} | undefined;
			const leavesAll = branch ? branch.option.leavesOf(branch.state) : [];
			for (const thing of [...this.options, ...leavesAll]) {
				const state = opts.find((_) => _.option === thing)?.state ?? "";
				if (thing.required && !thing.filled(state)) {
					throw new OptionError(I18n.commands.required(thing.localizedName));
				}
			}
			if (branch && !branch.option.filled(branch.state)) {
				throw new OptionError(I18n.commands.required(branch.option.localizedName));
			}
			const leafEntries = opts
				.filter(
					(_) =>
						_ !== branch &&
						!(_.option instanceof SubCommandOption) &&
						_.option.filled(_.state),
				)
				.map(({option, state}) => {
					return option.toJson(state);
				});
			const options = branch
				? [branch.option.wireEntry(branch.state, leafEntries)]
				: leafEntries;

			await fetch(this.info.api + "/interactions", {
				method: "POST",
				headers: this.headers,
				body: JSON.stringify({
					type: 2,
					nonce: nonce,
					guild_id: wireGuildId(channel.owner),
					channel_id: channel.id,
					application_id: this.applicationId,
					session_id: this.localuser.session_id,
					data: {
						application_command: this.rawJson,
						// Each attachment option's upload, paired with its value's ref id.
						attachments: opts
							.filter((_) => _.option instanceof AttachmentOption && _.option.filled(_.state))
							.map(({option, state}) =>
								(option as AttachmentOption).attachmentEntry(channel, state),
							),
						id: this.id,
						name: this.name,
						options,
						type: 1,
						version: this.version,
					},
				}),
			});
			this.state.delete(channel);
		} catch (e) {
			if (e instanceof OptionError) {
				const message = e.message;
				const error = document.createElement("span");
				error.classList.add("commandError");
				error.textContent = message;
				html.parentElement?.append(error);
				removeAni(error, 25000);
			}
			return false;
		}
		return true;
	}
}
abstract class Option {
	type: number;
	required: boolean;
	name: string;
	private description: string;
	private nameLocalizations: Record<string, string>;
	private descriptionLocalizations: Record<string, string>;
	constructor(optionjson: commandOptionJson) {
		this.required = optionjson.required || false;
		this.name = optionjson.name;
		this.nameLocalizations = optionjson.name_localizations || {};
		this.description = optionjson.description;
		this.descriptionLocalizations = optionjson.description_localizations || {};
		this.type = optionjson.type;
	}
	match(str: string) {
		return str === this.name;
	}
	get localizedName() {
		return this.nameLocalizations[I18n.lang] || this.name;
	}
	get localizedDescription() {
		return this.descriptionLocalizations[I18n.lang] || this.description;
	}
	static toOption(optionjson: commandOptionJson, owner: Command): Option {
		switch (optionjson.type) {
			case 3:
				return new StringOption(optionjson, owner);
			case 4:
				return new IntegerOption(optionjson, owner);
			case 5:
				return new BooleanOption(optionjson, owner);
			case 1:
				return new SubCommandOption(optionjson, owner);
			case 2:
				return new SubCommandGroupOption(optionjson, owner);
			case 6:
			case 7:
			case 8:
			case 9:
				return new EntityOption(optionjson, owner);
			case 10:
				return new NumberOption(optionjson, owner);
			case 11:
				return new AttachmentOption(optionjson, owner);
			default:
				return new ErrorOption(optionjson);
		}
	}
	abstract toHTML(state: string, channel: Channel): HTMLElement;
	imprintName(html: HTMLElement) {
		html.setAttribute("commandName", this.name);
	}
	similar(search: string) {
		if (search.length === 0) {
			return 0.1;
		}
		const similar = (str: string) => {
			if (str.includes(search)) {
				return search.length / str.length;
			} else if (str.toLowerCase().includes(search.toLowerCase())) {
				return str.length / str.length / 1.4;
			} else {
				return 0;
			}
		};
		return Math.max(
			similar(this.name),
			similar(this.description),
			similar(this.localizedDescription),
			similar(this.localizedName),
		);
	}
	toJson(state: string) {
		return {
			value: this.getValue(state),
			type: this.type,
			name: this.name,
		};
	}
	/** Whether `state` counts as answered. An unanswered required option blocks the send; an
	 * unanswered optional one is omitted from it (Discord's behavior). */
	filled(state: string): boolean {
		return state !== "";
	}
	getValue(state: string): string | number | boolean {
		return state;
	}
}
class ErrorOption extends Option {
	constructor(optionjson: commandOptionJson) {
		super(optionjson);
		this.required = false;
	}
	toHTML(): HTMLElement {
		const span = document.createElement("span");
		this.imprintName(span);
		span.textContent = "Fermo doesn't impl this yet";
		return span;
	}
}
class OptionError extends Error {
	constructor(reason: string) {
		super(reason);
	}
}
class StringOption extends Option {
	minLeng: number;
	maxLeng: number;
	choices: commandOptionJson["choices"];
	autocomplete: boolean;
	owner: Command;
	constructor(optionjson: commandOptionJson, owner: Command) {
		super(optionjson);
		this.owner = owner;
		this.minLeng = optionjson.min_length || 0;
		this.maxLeng = optionjson.min_length || 6000;
		this.choices = optionjson.choices;
		this.autocomplete = optionjson.autocomplete || false;
	}

	toHTML(state: string, channel: Channel): HTMLElement {
		const div = document.createElement("div");
		div.contentEditable = "false";
		div.classList.add("flexltr", "commandinput");
		this.imprintName(div);

		const label = document.createElement("span");
		label.textContent = this.localizedName + ":";

		const input = document.createElement("input");
		input.type = "text";
		input.value = state;
		input.onkeydown = (e) => {
			if (input.selectionStart === 0 && e.key === "Backspace") {
				const before = !!div.nextSibling;
				const sib = div.nextSibling || div.previousSibling;
				div.remove();
				focusElm(sib as HTMLElement, before);
				e.preventDefault();
				e.stopImmediatePropagation();
			}
		};
		input.onkeyup = (e) => {
			if (input.selectionStart === input.value.length && e.key === "ArrowRight") {
				focusElm(div, false);
			}
			const last = this.owner.getState(this, channel);
			this.owner.stateChange(this, channel, input.value);
			if (this.choices?.length && last !== input.value) {
				this.displayChoices(input, channel);
			}
		};

		div.append(label, input);
		return div;
	}
	displayChoices(input: HTMLInputElement, channel: Channel) {
		const value = input.value;
		if (!this.choices) return;
		const similar = (str?: string | null) => {
			if (str === null || str === undefined) return 0;
			if (str.includes(value)) {
				return value.length / str.length;
			} else if (str.toLowerCase().includes(value.toLowerCase())) {
				return str.length / str.length / 1.4;
			} else {
				return 0;
			}
		};

		const options = (
			value
				? this.choices
						.map(
							(_) =>
								[_, Math.max(similar(_.name), similar(_.name_localizations?.[I18n.lang]))] as const,
						)
						.filter((_) => _[1] !== 0)
						.sort((a, b) => a[1] - b[1])
						.map((_) => _[0])
				: this.choices
		).slice(0, 10);

		this.owner.localuser.MDSearchOptions(
			options.map((elm) => {
				return [
					`${elm.name_localizations?.[I18n.lang] || elm.name}`,
					"",
					undefined,
					() => {
						input.value = elm.name_localizations?.[I18n.lang] || elm.name;
						this.owner.stateChange(this, channel, input.value);
						return true;
					},
				] as const;
			}),
			"",
		);
	}
	getValue(state: string) {
		if (this.choices?.length) {
			const choice = this.choices.find((choice) => {
				if (choice.name === state) {
					return true;
				} else if (choice.name_localizations?.[I18n.lang] === state) {
					return true;
				}
				return false;
			});
			if (choice) {
				return choice.value;
			}
			throw new OptionError(I18n.commands.errorNotValid(state || '""', this.localizedName));
		}
		return state;
	}
}
class NumberishOption extends Option {
	min?: number;
	max?: number;
	integer: boolean;
	owner: Command;
	constructor(optionjson: commandOptionJson, owner: Command, integer: boolean) {
		super(optionjson);
		this.owner = owner;
		this.integer = integer;
		this.min = optionjson.min_value;
		this.max = optionjson.max_value;
	}
	toHTML(state: string, channel: Channel): HTMLElement {
		const div = document.createElement("div");
		div.contentEditable = "false";
		div.classList.add("flexltr", "commandinput");
		this.imprintName(div);

		const label = document.createElement("span");
		label.textContent = this.localizedName + ":";

		const input = document.createElement("input");
		input.type = "number";
		input.step = this.integer ? "1" : "any";
		if (this.min !== undefined) input.min = String(this.min);
		if (this.max !== undefined) input.max = String(this.max);
		input.value = state;
		input.onkeydown = (e) => {
			if (input.selectionStart === 0 && e.key === "Backspace") {
				const before = !!div.nextSibling;
				const sib = div.nextSibling || div.previousSibling;
				div.remove();
				focusElm(sib as HTMLElement, before);
				e.preventDefault();
				e.stopImmediatePropagation();
			}
		};
		input.onkeyup = (e) => {
			if (input.selectionStart === input.value.length && e.key === "ArrowRight") {
				focusElm(div, false);
			}
			this.owner.stateChange(this, channel, input.value);
		};
		// Spinner clicks change the value without firing any key event.
		input.oninput = () => {
			this.owner.stateChange(this, channel, input.value);
		};

		div.append(label, input);
		return div;
	}
	getValue(state: string) {
		const num = Number(state);
		if (state === "" || !Number.isFinite(num)) {
			// An empty state is filtered out before toJson; reaching here means a logic slip.
			// isFinite also rejects NaN and Infinity (JSON.stringify would emit null for it).
			throw new OptionError(I18n.commands.notNumber(this.localizedName));
		}
		if (this.integer && !Number.isInteger(num)) {
			throw new OptionError(I18n.commands.notInteger(this.localizedName));
		}
		if (this.min !== undefined && num < this.min) {
			throw new OptionError(I18n.commands.numberMin(this.localizedName, String(this.min)));
		}
		if (this.max !== undefined && num > this.max) {
			throw new OptionError(I18n.commands.numberMax(this.localizedName, String(this.max)));
		}
		return num;
	}
}
class IntegerOption extends NumberishOption {
	constructor(optionjson: commandOptionJson, owner: Command) {
		super(optionjson, owner, true);
	}
}
class NumberOption extends NumberishOption {
	constructor(optionjson: commandOptionJson, owner: Command) {
		super(optionjson, owner, false);
	}
}
class BooleanOption extends Option {
	owner: Command;
	constructor(optionjson: commandOptionJson, owner: Command) {
		super(optionjson);
		this.owner = owner;
	}
	toHTML(state: string, channel: Channel): HTMLElement {
		const div = document.createElement("div");
		div.contentEditable = "false";
		div.classList.add("flexltr", "commandinput");
		this.imprintName(div);

		const label = document.createElement("span");
		label.textContent = this.localizedName + ":";

		const input = document.createElement("input");
		input.type = "checkbox";
		input.checked = state === "true";
		input.onchange = () => {
			// Touching the toggle is an explicit answer; "false" stays filled, like Discord.
			this.owner.stateChange(this, channel, input.checked ? "true" : "false");
		};
		input.onkeydown = (e) => {
			if (e.key === "Backspace") {
				const before = !!div.nextSibling;
				const sib = div.nextSibling || div.previousSibling;
				div.remove();
				focusElm(sib as HTMLElement, before);
				e.preventDefault();
				e.stopImmediatePropagation();
			}
		};

		div.append(label, input);
		return div;
	}
	filled(state: string): boolean {
		return state === "true" || state === "false";
	}
	getValue(state: string) {
		return state === "true";
	}
}
class EntityOption extends Option {
	owner: Command;
	kind: "user" | "channel" | "role" | "mentionable";
	channelTypes?: number[];
	constructor(optionjson: commandOptionJson, owner: Command) {
		super(optionjson);
		this.owner = owner;
		this.kind =
			optionjson.type === 6
				? "user"
				: optionjson.type === 7
					? "channel"
					: optionjson.type === 8
						? "role"
						: "mentionable";
		this.channelTypes = optionjson.channel_types;
	}
	/** Every pickable entity in this channel's context: chip display, snowflake value, and a
	 * match score for a query (the entity's own compare/similar when it has one — the same
	 * ranking the composer's @/# popups use, matching nick, username and id). */
	collect(
		channel: Channel,
	): {display: string; value: string; score: (query: string) => number}[] {
		const out: {display: string; value: string; score: (query: string) => number}[] = [];
		const displayRank = (display: string) => (query: string) => {
			if (display.includes(query)) return query.length / display.length;
			if (display.toLowerCase().includes(query.toLowerCase()))
				return query.length / display.length / 1.2;
			return 0;
		};
		const guild = channel.guild;
		if (guild.id === "@me") {
			// A DM has roles or guild channels for no one; only people are pickable here.
			if (this.kind !== "user" && this.kind !== "mentionable") return out;
			const users = (
				channel as unknown as {
					users?: {
						id: string;
						name?: string;
						username?: string;
						compare?: (query: string) => number;
					}[];
				}
			).users;
			for (const user of users || []) {
				const display = "@" + (user.name || user.username);
				out.push({display, value: user.id, score: user.compare || displayRank(display)});
			}
			return out;
		}
		const g = guild as unknown as {
			id: string;
			members?: Iterable<{
				id: string;
				name?: string;
				user?: {username: string};
				compare?: (query: string) => number;
			}>;
			roles?: {id: string; name: string; compare?: (query: string) => number}[];
			channels?: Channel[];
		};
		if (this.kind !== "channel") {
			for (const member of g.members || []) {
				const display = "@" + (member.name || member.user?.username);
				out.push({display, value: member.id, score: member.compare || displayRank(display)});
			}
		}
		if (this.kind === "role" || this.kind === "mentionable") {
			// The guild's @everyone role shares the guild's id; it isn't a pickable role.
			for (const role of (g.roles || []).filter((_) => _.id !== g.id)) {
				const display = "@" + role.name;
				out.push({display, value: role.id, score: role.compare || displayRank(display)});
			}
		}
		if (this.kind === "channel" || this.kind === "mentionable") {
			for (const chan of (g.channels || []).filter((_) => _.visible)) {
				if (this.channelTypes && !this.channelTypes.includes((chan as {type: number}).type))
					continue;
				out.push({
					display: "#" + chan.name,
					value: chan.id,
					// Channel.similar returns -1 for categories, excluding them.
					score: chan.similar ? chan.similar.bind(chan) : displayRank("#" + chan.name),
				});
			}
		}
		return out;
	}
	/** Candidates matching `query`, capped like the other popups. Sorted ascending because
	 * MDSearchOptions prepends each row: the best match renders at the top. */
	candidates(channel: Channel, query: string): {display: string; value: string}[] {
		return this.collect(channel)
			.map((c) => ({c, rank: c.score(query)}))
			.filter((_) => _.rank > 0)
			.sort((a, b) => a.rank - b.rank)
			.slice(0, 8)
			.map((_) => ({display: _.c.display, value: _.c.value}));
	}
	/** The chip text for an already-picked id (the raw id if it resolves to nothing). */
	describe(channel: Channel, state: string) {
		if (state === "") return "";
		const hit = this.collect(channel).find((_) => _.value === state);
		return hit ? hit.display : state;
	}
	displayCandidates(input: HTMLInputElement, channel: Channel) {
		this.owner.localuser.MDSearchOptions(
			this.candidates(channel, input.value).map((c) => {
				return [
					c.display,
					"",
					undefined,
					() => {
						input.value = c.display;
						this.owner.stateChange(this, channel, c.value);
						return true;
					},
				] as const;
			}),
			"",
		);
	}
	toHTML(state: string, channel: Channel): HTMLElement {
		const div = document.createElement("div");
		div.contentEditable = "false";
		div.classList.add("flexltr", "commandinput");
		this.imprintName(div);

		const label = document.createElement("span");
		label.textContent = this.localizedName + ":";

		const input = document.createElement("input");
		input.type = "text";
		input.placeholder =
			this.kind === "user"
				? I18n.commands.placeholderUser()
				: this.kind === "channel"
					? I18n.commands.placeholderChannel()
					: this.kind === "role"
						? I18n.commands.placeholderRole()
						: I18n.commands.placeholderMentionable();
		input.value = this.describe(channel, state);
		input.onkeydown = (e) => {
			if (input.selectionStart === 0 && input.value.length === 0 && e.key === "Backspace") {
				const before = !!div.nextSibling;
				const sib = div.nextSibling || div.previousSibling;
				div.remove();
				focusElm(sib as HTMLElement, before);
				e.preventDefault();
				e.stopImmediatePropagation();
			}
		};
		input.onkeyup = (e) => {
			if (input.selectionStart === input.value.length && e.key === "ArrowRight") {
				focusElm(div, false);
			}
			this.owner.stateChange(this, channel, input.value);
			this.displayCandidates(input, channel);
		};

		div.append(label, input);
		return div;
	}
	getValue(state: string) {
		// The wire value is the picked entity's snowflake; anything else (a typed name that was
		// never picked) is refused client-side, where the server would refuse it too.
		if (/^\d+$/.test(state)) return state;
		throw new OptionError(I18n.commands.errorNotValid(state || '""', this.localizedName));
	}
}
/** Upload ref ids must differ across the picks of one command: the server pairs each option's
 * value with its data.attachments entry by id. */
let attachmentRefIds = 0;
class AttachmentOption extends Option {
	owner: Command;
	/** Per channel: the upload behind the state's ref id (the channel's own upload flow). */
	uploads = new WeakMap<Channel, {filename: string; upload_filename: string}>();
	constructor(optionjson: commandOptionJson, owner: Command) {
		super(optionjson);
		this.owner = owner;
	}
	/** Uploads the picked file and records the pairing the submit needs. The state is set only
	 * once the bytes have landed, so a submit can never race the upload. */
	async pick(files: globalThis.File[], channel: Channel) {
		const file = files[0];
		if (!file) return;
		const [entry] = await channel.uploadFile([file], [++attachmentRefIds + ""]);
		if (!entry) return;
		this.uploads.set(channel, {filename: file.name, upload_filename: entry.upload_filename});
		this.owner.stateChange(this, channel, entry.id);
	}
	/** The data.attachments entry pairing this option's value with its upload; a value with
	 * nothing uploaded behind it (a pasted id) is refused, as the server would refuse it. */
	attachmentEntry(channel: Channel, state: string) {
		const upload = this.uploads.get(channel);
		if (!/^\d+$/.test(state) || !upload) {
			throw new OptionError(I18n.commands.errorNotValid(state || '""', this.localizedName));
		}
		return {id: state, filename: upload.filename, uploaded_filename: upload.upload_filename};
	}
	toHTML(_state: string, channel: Channel): HTMLElement {
		const div = document.createElement("div");
		div.contentEditable = "false";
		div.classList.add("flexltr", "commandinput");
		this.imprintName(div);

		const label = document.createElement("span");
		label.textContent = this.localizedName + ":";

		const input = document.createElement("input");
		input.type = "file";
		const status = document.createElement("span");
		const uploaded = this.uploads.get(channel);
		if (uploaded) status.textContent = uploaded.filename;
		input.onchange = async () => {
			const files = Array.from(input.files || []);
			if (!files[0]) return;
			status.textContent = I18n.commands.uploading();
			try {
				await this.pick(files, channel);
				status.textContent = this.uploads.get(channel)?.filename ?? "";
			} catch (e) {
				// The native input still names the file; without this the failure is invisible and
				// re-picking the SAME file fires no change event at all (Chromium).
				status.textContent = "";
				input.value = "";
				const error = document.createElement("span");
				error.classList.add("commandError");
				error.textContent = e instanceof Error ? e.message : String(e);
				div.parentElement?.append(error);
				removeAni(error, 25000);
			}
		};
		input.onkeydown = (e) => {
			if (e.key === "Backspace") {
				const before = !!div.nextSibling;
				const sib = div.nextSibling || div.previousSibling;
				div.remove();
				focusElm(sib as HTMLElement, before);
				e.preventDefault();
				e.stopImmediatePropagation();
			}
		};

		div.append(label, input, status);
		return div;
	}
	getValue(state: string) {
		if (/^\d+$/.test(state)) return state;
		throw new OptionError(I18n.commands.errorNotValid(state || '""', this.localizedName));
	}
}
/** A subcommand (type 1) or, subclassed, a subcommand group (type 2). The chip this renders is
 * the command's branch picker: its popup offers the sibling branches (and, for groups, a second
 * step offering the group's subcommands), the state holds the PICKED subcommand's name, and the
 * picked branch's leaf options render as chips after it. */
class SubCommandOption extends Option {
	owner: Command;
	children: Option[];
	constructor(optionjson: commandOptionJson, owner: Command) {
		super(optionjson);
		this.owner = owner;
		this.children = (optionjson.options || []).map((_) => Option.toOption(_, owner));
	}
	/** Every branch the popup can target (the command's sibling subcommands/groups). */
	branches(): SubCommandOption[] {
		return this.owner.options.filter((_) => _ instanceof SubCommandOption) as SubCommandOption[];
	}
	/** Every leaf option of every branch (for state seeding and cleanup). */
	allLeaves(): Option[] {
		return this.branches().flatMap((branch) =>
			branch instanceof SubCommandGroupOption
				? branch.children.flatMap((sub) =>
						sub instanceof SubCommandOption ? sub.children : [],
					)
				: branch.children,
		);
	}
	/** The leaf options behind a picked branch: a subcommand name, or "group/sub" for groups. */
	leavesOf(state: string): Option[] {
		const [groupName, subName] = state.includes("/") ? state.split("/") : [undefined, state];
		for (const branch of this.branches()) {
			if (groupName) {
				const sub = branch.children.find((child) => child.name === subName);
				if (branch.name === groupName && sub instanceof SubCommandOption) {
					return sub.children;
				}
			} else if (branch.name === state && !(branch instanceof SubCommandGroupOption)) {
				return branch.children;
			}
		}
		return [];
	}
	filled(state: string): boolean {
		return state !== "";
	}
	getValue(state: string) {
		return state;
	}
	/** The wire entry: the picked subcommand nesting the leaf entries. */
	wireEntry(state: string, leaves: {value: unknown; type: number; name: string}[]) {
		return {name: state, type: 1, options: leaves} as {
			name: string;
			type: number;
			options: unknown[];
		};
	}
	/** Removes every option chip after `div` (the previous branch's leaves). */
	clearFollowing(div: HTMLElement) {
		let node = div.nextElementSibling;
		while (node) {
			const next = node.nextElementSibling;
			if (node instanceof HTMLElement && node.classList.contains("commandinput")) {
				node.remove();
			}
			node = next;
		}
	}
	/** Replaces the chips after `div` with the picked branch's leaves — and seeds their state
	 * entries, without which their inputs can never record values (stateChange only mutates
	 * existing entries). Stale entries of a previously picked branch are dropped. */
	renderLeaves(div: HTMLElement, state: string, channel: Channel) {
		this.clearFollowing(div);
		const leaves = this.leavesOf(state);
		const states = this.owner.state.get(channel);
		if (states) {
			const stale = new Set(this.allLeaves());
			const kept = states.filter((s) => typeof s === "string" || !stale.has(s.option));
			for (const leaf of leaves) {
				kept.push({option: leaf, state: ""});
			}
			this.owner.state.set(channel, kept);
		}
		let cursor = div;
		for (const leaf of leaves) {
			const chip = leaf.toHTML("", channel);
			cursor.after(chip);
			cursor = chip;
		}
	}
	toHTML(state: string, channel: Channel): HTMLElement {
		const div = document.createElement("div");
		div.contentEditable = "false";
		div.classList.add("flexltr", "commandinput");
		this.imprintName(div);

		const label = document.createElement("span");
		label.textContent = this.localizedName + ":";

		const input = document.createElement("input");
		input.type = "text";
		input.value = state || this.name;
		// A group command picks twice: the group, then its subcommand.
		let group: SubCommandGroupOption | undefined;
		const offer = () => {
			const entries =
				group === undefined
					? this.branches()
					: (group.children.filter((_) => _ instanceof SubCommandOption) as SubCommandOption[]);
			this.owner.localuser.MDSearchOptions(
				entries
					.filter((branch) => branch.localizedName.includes(input.value))
					.slice(0, 8)
					.map((branch) => {
						return [
							branch.localizedName,
							"",
							undefined,
							() => {
								if (
									group === undefined &&
									branch instanceof SubCommandGroupOption
								) {
									group = branch;
									input.value = "";
									offer();
								} else {
									// Groups persist their pick as "group/sub" so the wire names
									// the group the user actually chose, not the first one.
									const picked =
										group === undefined
											? branch.name
											: group.name + "/" + branch.name;
									input.value = branch.localizedName;
									this.owner.stateChange(this, channel, picked);
									this.renderLeaves(div, picked, channel);
								}
								return true;
							},
						] as const;
					}),
				"",
			);
		};
		input.onkeydown = (e) => {
			if (input.selectionStart === 0 && input.value.length === 0 && e.key === "Backspace") {
				const before = !!div.nextSibling;
				const sib = div.nextSibling || div.previousSibling;
				// The branch chip carries its leaves; they go with it.
				this.clearFollowing(div);
				div.remove();
				focusElm(sib as HTMLElement, before);
				e.preventDefault();
				e.stopImmediatePropagation();
			}
		};
		input.onkeyup = (e) => {
			if (input.selectionStart === input.value.length && e.key === "ArrowRight") {
				focusElm(div, false);
			}
			offer();
		};
		input.oninput = offer;

		div.append(label, input);
		if (state !== "") {
			queueMicrotask(() => {
				if (div.isConnected) this.renderLeaves(div, state, channel);
			});
		} else if (this.branches().every((_) => !(_ instanceof SubCommandGroupOption))) {
			// A freshly inserted branch chip among plain subcommands picks itself and shows its
			// leaves; group commands wait for the user's two picks.
			queueMicrotask(() => {
				if (div.isConnected) {
					this.owner.stateChange(this, channel, this.name);
					this.renderLeaves(div, this.name, channel);
				}
			});
		}
		return div;
	}
}
class SubCommandGroupOption extends SubCommandOption {
	wireEntry(state: string, leaves: {value: unknown; type: number; name: string}[]) {
		const [groupName, subName] = state.split("/");
		return {
			name: groupName,
			type: 2,
			options: [{name: subName, type: 1, options: leaves}],
		};
	}
}
