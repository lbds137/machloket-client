import {Channel} from "../channel.js";
import {Guild} from "../guild.js";
import {I18n} from "../i18n.js";
import {commandJson, commandOptionJson} from "../jsontypes.js";
import {Localuser} from "../localuser.js";
import {SnowFlake} from "../snowflake.js";
import {wireGuildId} from "./compontents.js";
import {removeAni} from "../utils/utils.js";
import {fetchRetryOnce} from "../utils/rateLimit.js";

/** One pickable row of the command list: the command itself, or one branch of a subcommand
 * command — Discord lists every runnable path ("/name sub", "/name group sub"), never a
 * bare group. */
export type CommandInvocation = {
	/** The branch chip's wire state: undefined, "sub", or "group/sub". */
	branch?: string;
	/** The command's localized base name, without the slash. */
	base: string;
	/** The localized sub path segments. */
	subs: string[];
	description: string;
};
function focusInput(html: HTMLElement) {
	const input = html.getElementsByTagName("input")[0];
	if (input) input.focus();
}
/** Backspace at the start of an empty chip input removes the chip — and removing the FIRST
 * chip exits command mode entirely (the command front goes with it, as Discord does). */
function chipBackspace(
	div: HTMLElement,
	input: HTMLInputElement,
	channel: Channel,
	e: KeyboardEvent,
	emptyOnly = true,
) {
	if (e.key !== "Backspace") return;
	if (emptyOnly && !(input.selectionStart === 0 && input.value.length === 0)) return;
	const prev = div.previousElementSibling;
	if (!prev || prev.classList.contains("commandFront")) {
		channel.exitCommand();
	} else {
		const before = !!div.nextSibling;
		const sib = div.nextSibling || div.previousSibling;
		div.remove();
		focusElm(sib as HTMLElement, before);
	}
	e.preventDefault();
	e.stopImmediatePropagation();
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
/** The box's trailing text node — the caret's home when no field is revealed; typing there
 * opens the option popup. Created empty when absent. */
function ensureTrailing(html: HTMLElement): Text {
	const last = html.lastChild;
	if (last instanceof Text) return last;
	const node = new Text("");
	html.append(node);
	return node;
}
/** ArrowRight at a chip's end steps the caret just past THAT chip — the next visible chip
 * stays one step away; past the last chip the fresh node is the trailing one, where typing
 * (or the step itself) opens the option popup. */
function chipExit(
	div: HTMLElement,
	input: HTMLInputElement,
	command: Command,
	channel: Channel,
	e: KeyboardEvent,
) {
	if (!(e.key === "ArrowRight" && input.selectionStart === input.value.length)) return;
	const box = command.boxes.get(channel) ?? div.parentElement;
	if (!box) return;
	let node: Text;
	if (div.nextSibling instanceof Text) {
		node = div.nextSibling;
	} else {
		node = new Text("");
		div.after(node);
	}
	focusElm(node, false);
	command.searchAtr(node, channel, box);
}
/** A popup row previewing `option`: its name, description, and required/optional mark — the
 * inventory of what the command still takes. */
function optionRow(option: Option): HTMLElement {
	const row = document.createElement("span");
	row.classList.add("commandOptionRow");
	const name = document.createElement("span");
	name.classList.add("commandOptionName");
	name.textContent = option.localizedName;
	const desc = document.createElement("span");
	desc.classList.add("commandOptionDesc");
	desc.textContent = option.localizedDescription;
	const mark = document.createElement("span");
	mark.classList.add("commandOptionMark");
	mark.textContent = option.required
		? I18n.commands.optionRequired()
		: I18n.commands.optional();
	row.append(name, desc, mark);
	return row;
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
	/** The picker's rows for this command: itself, or one entry per subcommand branch. */
	get invocations(): CommandInvocation[] {
		const branches = this.options.filter((_) => _ instanceof SubCommandOption);
		if (!branches.length || branches.length !== this.options.length) {
			return [
				{
					base: this.localizedName,
					subs: [],
					description: this.localizedDescription,
				},
			];
		}
		const out: CommandInvocation[] = [];
		for (const branch of branches as SubCommandOption[]) {
			if (branch instanceof SubCommandGroupOption) {
				for (const sub of branch.children.filter(
					(_) => _ instanceof SubCommandOption,
				) as SubCommandOption[]) {
					out.push({
						branch: branch.name + "/" + sub.name,
						base: this.localizedName,
						subs: [branch.localizedName, sub.localizedName],
						description: sub.localizedDescription,
					});
				}
			} else {
				out.push({
					branch: branch.name,
					base: this.localizedName,
					subs: [branch.localizedName],
					description: branch.localizedDescription,
				});
			}
		}
		return out;
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
					const option = this.resolveOption(name || "", states);
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
			// searchAtr may have committed fresher state already (a colon-commit runs its own
			// collect with the typed name consumed); this earlier snapshot would resurrect
			// the typed text as a ghost — a nested commit wins.
			if (this.state.get(channel) === states) {
				this.state.set(channel, build);
			}
		} else {
			this.state.delete(channel);
		}

		return gotname;
	}
	/** Resolves a chip's commandName to its option: the command's own options first, then
	 * the PICKED branch's leaves, then any branch's — cross-branch leaf-name reuse must
	 * resolve to the picked branch's leaf, never to an earlier branch's same-named one. */
	private resolveOption(
		name: string,
		states:
			| (
					| {
							option: Option;
							state: string;
					}
					| string
			)[]
			| undefined,
	): Option | undefined {
		const branchEntry = states?.find(
			(_) => _ instanceof Object && _.option instanceof SubCommandOption,
		) as {option: SubCommandOption; state: string} | undefined;
		return (
			this.options.find((_) => _.match(name)) ??
			(branchEntry
				? branchEntry.option.leavesOf(branchEntry.state).find((_) => _.match(name))
				: undefined) ??
			this.branchLeaves().find((_) => _.match(name))
		);
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
		// The insertable pool: the command's own options (branches are the branch picker's
		// business) plus the picked branch's leaves.
		const branchEntry = states.find(
			(_) => _ instanceof Object && _.option instanceof SubCommandOption,
		) as {option: SubCommandOption; state: string} | undefined;
		const pool = [
			...this.options.filter((obj) => !(obj instanceof SubCommandOption)),
			...(branchEntry ? branchEntry.option.leavesOf(branchEntry.state) : []),
		];
		const box = this.boxes.get(channel) ?? Divhtml;
		const entry = (option: Option) =>
			states.find((_) => _ instanceof Object && _.option === option) as {
				option: Option;
				state: string;
			} | undefined;
		// Offerable: unfilled, and without a chip already in view — a shown field (like the
		// current required one) is not re-offered, a hidden one is (it awaits its pick).
		const offerable = (option: Option) =>
			!option.filled(entry(option)?.state ?? "") &&
			!box.querySelector(
				`.commandinput:not(.commandHidden)[commandname="${CSS.escape(option.name)}"]`,
			);
		/** Brings `option`'s field in: reveals its hidden chip, or builds one at the caret when
		 * no chip exists (a backspaced field, or a fresh leaf). */
		const insert = (option: Option) => {
			const chip = box.querySelector(
				`.commandinput.commandHidden[commandname="${CSS.escape(option.name)}"]`,
			);
			if (chip instanceof HTMLElement) {
				chip.classList.remove("commandHidden");
			} else {
				textNode.after(option.toHTML(entry(option)?.state ?? "", channel));
			}
			textNode.textContent = "";
			this.collect(Divhtml, channel);
			focusInput(
				box.querySelector(
					`.commandinput:not(.commandHidden)[commandname="${CSS.escape(option.name)}"] input`,
				)?.parentElement ?? box,
			);
			// Focus left the text area for the new field: the popup stands down.
			this.localuser.MDSearchOptions(
				[],
				"",
				document.getElementById("searchOptions") as HTMLDivElement,
			);
		};
		// Inline commit: typing an option's name — with or without its colon — inserts that
		// field, as Discord reads it.
		const bare = text.replace(/:$/, "");
		if (bare) {
			const exact = pool.find(
				(opt) =>
					offerable(opt) && (opt.name === bare || opt.localizedName === bare),
			);
			if (exact) {
				insert(exact);
				return;
			}
		}
		const opts = pool
			.filter(offerable)
			.map((opt) => [opt, opt.similar(text)] as const)
			.filter((_) => _[1])
			// The array is worst-first (MDSearchOptions prepends each row, so the last renders
			// at the top): required options sort to the top of the popup, then best match
			// (ties A-Z, like the command picker's tie order).
			.sort(
				(a, b) =>
					Number(a[0].required) - Number(b[0].required) ||
					a[1] - b[1] ||
					b[0].name.localeCompare(a[0].name),
			)
			.slice(0, 8)
			.map((_) => _[0]);
		this.localuser.MDSearchOptions(
			opts.map((opt) => {
				return [
					"",
					"",
					optionRow(opt),
					() => {
						insert(opt);
						return true;
					},
				];
			}),
			"",
			document.getElementById("searchOptions") as HTMLDivElement,
		);
		// With nothing typed, Enter must still run the command — the preview is a menu, not a
		// gate on optional-only commands (Tab still inserts the highlighted option). The
		// guard wraps whatever keyup MDSearchOptions just installed and is dropped whenever
		// keyup is reassigned (a typed query's popup, or the popup standing down).
		if (text === "") {
			const lu = this.localuser as Localuser & {
				optionPreviewEnterGuard?: (event: KeyboardEvent) => boolean;
			};
			if (lu.keyup !== lu.optionPreviewEnterGuard) {
				const delegate = lu.keyup.bind(lu);
				lu.optionPreviewEnterGuard = (event) =>
					event.key === "Enter" ? false : delegate(event);
				lu.keyup = lu.optionPreviewEnterGuard;
			}
		}
	}
	/** Where each channel's chips render, so progressive reveals can find them. */
	boxes = new WeakMap<Channel, HTMLElement>();
	render(html: HTMLElement, channel: Channel) {
		html.innerHTML = "";
		this.boxes.set(channel, html);
		let state = this.state.get(channel);
		if (!state) {
			// A command made of subcommands/groups seeds one branch picker instead of every
			// leaf; the picked branch brings its own. Otherwise every option seeds — an empty
			// optional is omitted at submit.
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
		// Progressive disclosure, Discord's model: every chip renders (hidden keeps its state
		// alive through collect()), but only an unfilled REQUIRED option (or the branch picker)
		// earns an auto-revealed field — optional fields wait for an explicit pick, previewed
		// by the option popup. A filled chip always stays visible: its value must not vanish.
		let target: HTMLElement | undefined = undefined;
		for (const thing of state) {
			if (typeof thing === "string") {
				html.append(thing);
				continue;
			}
			const {option, state: value} = thing;
			const opt = option.toHTML(value, channel);
			opt.classList.add("commandHidden");
			if (option.filled(value)) {
				opt.classList.remove("commandHidden");
			} else if (!target && (option.required || option instanceof SubCommandOption)) {
				target = opt;
			}
			html.append(opt);
		}
		if (target) {
			target.classList.remove("commandHidden");
			focusInput(target);
		} else {
			// No field to show: the caret's home is the trailing text node, where typing opens
			// the option popup (the inventory preview). The offer waits a microtask because
			// startCommand/renderLeaves run inside popup clicks, whose own handler clears the
			// popup after the callback.
			const node = ensureTrailing(html);
			focusElm(node, false);
			queueMicrotask(() => {
				if (html.isConnected && node.isConnected) {
					this.searchAtr(node, channel, html);
				}
			});
		}
	}
	/** Unhides the next hidden REQUIRED chip (document order = option order); an optional
	 * field joins only by an explicit pick from the option popup. One unanswered required field
	 * shows at a time: while one is in view, nothing more reveals (stateChange runs per
	 * keystroke, so without this every key in a filled field revealed one more). */
	revealNext(channel: Channel) {
		const box = this.boxes.get(channel);
		if (!box) return;
		const states = this.state.get(channel);
		for (const chip of box.querySelectorAll(".commandinput:not(.commandHidden)")) {
			const option = this.resolveOption(chip.getAttribute("commandName") || "", states);
			if (option?.required && !option.filled(this.getState(option, channel) ?? "")) return;
		}
		for (const chip of box.querySelectorAll(".commandinput.commandHidden")) {
			const option = this.resolveOption(chip.getAttribute("commandName") || "", states);
			if (option?.required) {
				chip.classList.remove("commandHidden");
				return;
			}
		}
	}
	/** Every leaf option of every branch (the fields a picked subcommand brings). */
	private branchLeaves(): Option[] {
		return this.options.flatMap((branch) =>
			branch instanceof SubCommandOption ? branch.allLeaves() : [],
		);
	}
	/** Unhides one option's chip by name (a required-error names its option). */
	revealOption(option: Option, channel: Channel) {
		this.boxes
			.get(channel)
			?.querySelector(`.commandinput[commandname="${CSS.escape(option.name)}"]`)
			?.classList.remove("commandHidden");
	}
	/** Starts the command with a branch already chosen (the picker's subcommand rows): the
	 * branch chip shows the pick and its leaves render, exactly as a manual pick leaves
	 * them. */
	prePick(channel: Channel, picked: string) {
		const branch = this.options.find((_) => _ instanceof SubCommandOption);
		const box = this.boxes.get(channel);
		if (!(branch instanceof SubCommandOption) || !box) return;
		const chip = box.querySelector(".commandinput");
		if (!(chip instanceof HTMLElement)) return;
		const [groupName, subName] = picked.includes("/")
			? picked.split("/")
			: [undefined, picked];
		const pickedBranch = branch
			.branches()
			.find((b) => b.name === (groupName ?? picked));
		const display = groupName
			? pickedBranch instanceof SubCommandGroupOption
				? (
						pickedBranch.children.find(
							(c) => c instanceof SubCommandOption && c.name === subName,
						) as SubCommandOption | undefined
					)?.localizedName
				: undefined
			: pickedBranch?.localizedName;
		const input = chip.querySelector("input");
		if (input && display) {
			input.value = display;
			branchShown.set(input, display);
		}
		this.stateChange(branch, channel, picked);
		branch.renderLeaves(chip, picked, channel);
	}
	stateChange(option: Option, channel: Channel, state: string) {
		const states = this.state.get(channel);
		if (!states) return;
		const stateObj = states.find((_) => _ instanceof Object && _.option === option);
		if (stateObj && stateObj instanceof Object) {
			stateObj.state = state;
			if (option.filled(state)) this.revealNext(channel);
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
		const nonce = Math.floor(Math.random() * 10 ** 9) + "";
		try {
			const states = this.state.get(channel);
			// Nothing collected (the box was cleared): nothing is sent, so no nonce to track.
			if (!states) return true;
			// The "used /command" label: the command's path with the picked branch.
			const branchLabel = states.find(
				(_) => _ instanceof Object && _.option instanceof SubCommandOption,
			) as {state: string} | undefined;
			this.localuser.registerCommandNonce(
				nonce,
				channel,
				this.name +
					(branchLabel?.state ? " " + branchLabel.state.replace("/", " ") : ""),
			);
			const opts = states.filter((_) => typeof _ !== "string");
			// A subcommand/group command nests: the picked branch carries the leaf entries.
			const branch = opts.find(
				(_) => _.option instanceof SubCommandOption,
			) as {option: SubCommandOption; state: string} | undefined;
			const leavesAll = branch ? branch.option.leavesOf(branch.state) : [];
			for (const thing of [...this.options, ...leavesAll]) {
				const state = opts.find((_) => _.option === thing)?.state ?? "";
				if (thing.required && !thing.filled(state)) {
					// The complaint brings the field into view: a hidden required option
					// would block with no field to fill.
					this.revealOption(thing, channel);
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

			const res = await fetchRetryOnce(this.info.api + "/interactions", {
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
			if (!res.ok) {
				// The command was not accepted: keep it exactly as it was, so the user sees the
				// failure and a retry resends the same payload (a lost POST used to clear the
				// composer as if the command had been sent).
				let message = `${res.status}`;
				try {
					const body = (await res.json()) as {
						message?: string;
						errors?: Record<string, {_errors?: {params?: {additionalProperty?: string}}[]}>;
					};
					if (body.message) message = `${res.status}: ${body.message}`;
					// The enforcement validator names the offending field; showing it turns
					// a bare "Invalid Form Body" into something actionable.
					const extra = Object.values(body.errors ?? {})
						.flatMap((e) => e?._errors ?? [])
						.map((e) => e.params?.additionalProperty)
						.filter(Boolean)[0];
					if (extra) message += ` (${extra})`;
				} catch {
					// A non-JSON body (a bare proxy error page) keeps the bare status.
				}
				// The nonce will never resolve now; drop it from both gates — the modal
				// suppression Set and the command-status channel map — so a late
				// INTERACTION_FAILURE can't stack "did not respond" on the real error.
				this.localuser.forgetCommandNonce(nonce);
				const error = document.createElement("span");
				error.classList.add("commandError");
				error.textContent = message;
				html.parentElement?.append(error);
				removeAni(error, 25000);
				return false;
			}
			this.state.delete(channel);
		} catch (e) {
			// Blocked by an option, or the POST never left the browser: nothing was sent.
			this.localuser.forgetCommandNonce(nonce);
			if (e instanceof OptionError) {
				const message = e.message;
				const error = document.createElement("span");
				error.classList.add("commandError");
				error.textContent = message;
				html.parentElement?.append(error);
				removeAni(error, 25000);
			} else if (e instanceof Error) {
				// A POST that never left the browser (offline, refused) used to fail
				// silently and only surface as a later "did not respond".
				const error = document.createElement("span");
				error.classList.add("commandError");
				error.textContent = e.message;
				html.parentElement?.append(error);
				removeAni(error, 25000);
			}
			return false;
		}
		return true;
	}
	private submittingContext = false;
	/** A context-menu command (USER 2 / MESSAGE 3) invoked on `target_id`: the same type-2 POST
	 * as a slash command, but the data names the target and carries no options (the server
	 * builds the resolved entities and rejects a missing target). Returns false when refused -
	 * or when a send is already in flight, so a double tap fires the command once. */
	async submitContext(target_id: string, channel: Channel, anchor?: HTMLElement): Promise<boolean> {
		if (this.submittingContext) return false;
		this.submittingContext = true;
		try {
			return await this.sendContext(target_id, channel, anchor);
		} finally {
			this.submittingContext = false;
		}
	}
	private async sendContext(target_id: string, channel: Channel, anchor?: HTMLElement): Promise<boolean> {
		const nonce = Math.floor(Math.random() * 10 ** 9) + "";
		this.localuser.registerCommandNonce(nonce, channel, this.name);
		try {
			const res = await fetchRetryOnce(this.info.api + "/interactions", {
				method: "POST",
				headers: this.headers,
				body: JSON.stringify({
					type: 2,
					nonce,
					guild_id: wireGuildId(channel.owner),
					channel_id: channel.id,
					application_id: this.applicationId,
					session_id: this.localuser.session_id,
					data: {
						id: this.id,
						name: this.name,
						type: this.type,
						target_id,
					},
				}),
			});
			if (!res.ok) {
				let message = `${res.status}`;
				try {
					const body = (await res.json()) as {message?: string};
					if (body.message) message = `${res.status}: ${body.message}`;
				} catch {
					// A non-JSON body keeps the bare status.
				}
				this.localuser.forgetCommandNonce(nonce);
				const error = document.createElement("span");
				error.classList.add("commandError");
				error.textContent = message;
				(anchor ?? document.body).append(error);
				removeAni(error, 25000);
				return false;
			}
			return true;
		} catch (e) {
			this.localuser.forgetCommandNonce(nonce);
			if (e instanceof Error) {
				// Same as the slash path: a POST that never left the browser shows why.
				const error = document.createElement("span");
				error.classList.add("commandError");
				error.textContent = e.message;
				(anchor ?? document.body).append(error);
				removeAni(error, 25000);
			}
			return false;
		}
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
		span.textContent = "Machloket doesn't implement this yet";
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
		this.maxLeng = optionjson.max_length || 6000;
		this.choices = optionjson.choices;
		this.autocomplete = optionjson.autocomplete || false;
	}

	toHTML(state: string, channel: Channel): HTMLElement {
		const div = document.createElement("div");
		div.contentEditable = "false";
		div.classList.add("flexltr", "commandinput");
		this.imprintName(div);

		const label = document.createElement("span");
		label.textContent =
			this.localizedName + (this.required ? ":" : " " + I18n.commands.optional() + ":");

		const input = document.createElement("input");
		input.type = "text";
		input.value = state;
		input.onkeydown = (e) => {
			chipBackspace(div, input, channel, e);
		};
		input.onkeyup = (e) => {
			chipExit(div, input, this.owner, channel, e);
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
		// Counted in characters as typed, not UTF-16 units (an emoji is one).
		const length = [...state].length;
		if (length < this.minLeng) {
			throw new OptionError(I18n.commands.textMin(this.localizedName, String(this.minLeng)));
		}
		if (length > this.maxLeng) {
			throw new OptionError(I18n.commands.textMax(this.localizedName, String(this.maxLeng)));
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
		label.textContent =
			this.localizedName + (this.required ? ":" : " " + I18n.commands.optional() + ":");

		const input = document.createElement("input");
		input.type = "number";
		input.step = this.integer ? "1" : "any";
		if (this.min !== undefined) input.min = String(this.min);
		if (this.max !== undefined) input.max = String(this.max);
		input.value = state;
		input.onkeydown = (e) => {
			chipBackspace(div, input, channel, e);
		};
		input.onkeyup = (e) => {
			chipExit(div, input, this.owner, channel, e);
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
		label.textContent =
			this.localizedName + (this.required ? ":" : " " + I18n.commands.optional() + ":");

		const input = document.createElement("input");
		input.type = "checkbox";
		input.checked = state === "true";
		input.onchange = () => {
			// Touching the toggle is an explicit answer; "false" stays filled, like Discord.
			this.owner.stateChange(this, channel, input.checked ? "true" : "false");
		};
		input.onkeydown = (e) => {
			chipBackspace(div, input, channel, e, false);
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
	 * MDSearchOptions prepends each row: the best match renders at the top (ties A-Z). */
	candidates(channel: Channel, query: string): {display: string; value: string}[] {
		return this.collect(channel)
			.map((c) => ({c, rank: c.score(query)}))
			.filter((_) => _.rank > 0)
			.sort((a, b) => a.rank - b.rank || a.c.display.localeCompare(b.c.display))
			.slice(0, 8)
			.map((_) => ({display: _.c.display, value: _.c.value}));
	}
	/** The chip text for an already-picked id (the raw id if it resolves to nothing). */
	describe(channel: Channel, state: string) {
		if (state === "") return "";
		const hit = this.collect(channel).find((_) => _.value === state);
		return hit ? hit.display : state;
	}
	/** Per input: the text the state last followed (a typed query or a pick's display). A keyup
	 * that leaves the text as it was — Enter, Tab, an arrow — must not touch the state or the
	 * popup: rewriting the state to "@Name" would lose the picked id, and rebuilding the popup
	 * would reset its selection and make the sending Enter pick again. */
	private followed = new WeakMap<HTMLInputElement, string>();
	displayCandidates(input: HTMLInputElement, channel: Channel) {
		this.owner.localuser.MDSearchOptions(
			this.candidates(channel, input.value).map((c) => {
				return [
					c.display,
					"",
					undefined,
					() => {
						input.value = c.display;
						this.followed.set(input, c.display);
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
		label.textContent =
			this.localizedName + (this.required ? ":" : " " + I18n.commands.optional() + ":");

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
		this.followed.set(input, input.value);
		input.onkeydown = (e) => {
			chipBackspace(div, input, channel, e);
		};
		input.onkeyup = (e) => {
			chipExit(div, input, this.owner, channel, e);
			if (this.followed.get(input) === input.value) return;
			this.followed.set(input, input.value);
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
/** Per branch-picker input: the text its popup was last built for, or a pick displayed (the
 * popup's own pick or prePick's). A keyup that leaves the text unchanged — an arrow, Enter,
 * Tab — must not rebuild the popup: that resets the selection, and after a pick it re-offers
 * the branch so the sending Enter picks again. */
const branchShown = new WeakMap<HTMLInputElement, string>();
/** Upload ref ids must differ across the picks of one command: the server pairs each option's
 * value with its data.attachments entry by id. */
let attachmentRefIds = 0;
class AttachmentOption extends Option {
	owner: Command;
	/** Per channel: the latest upload and its ref id. It counts only while the state still holds
	 * that id — a sent or abandoned command reseeds the state, and the upload stays behind. */
	uploads = new WeakMap<Channel, {id: string; filename: string; upload_filename: string}>();
	/** The upload behind `state`, if `state` is still this channel's latest pick. */
	private uploadFor(channel: Channel, state: string) {
		const upload = this.uploads.get(channel);
		return upload && upload.id === state ? upload : undefined;
	}
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
		this.uploads.set(channel, {
			id: entry.id,
			filename: file.name,
			upload_filename: entry.upload_filename,
		});
		this.owner.stateChange(this, channel, entry.id);
	}
	/** The data.attachments entry pairing this option's value with its upload; a value with
	 * nothing uploaded behind it (a pasted id) is refused, as the server would refuse it. */
	attachmentEntry(channel: Channel, state: string) {
		const upload = this.uploadFor(channel, state);
		if (!/^\d+$/.test(state) || !upload) {
			throw new OptionError(I18n.commands.errorNotValid(state || '""', this.localizedName));
		}
		return {id: state, filename: upload.filename, uploaded_filename: upload.upload_filename};
	}
	toHTML(state: string, channel: Channel): HTMLElement {
		const div = document.createElement("div");
		div.contentEditable = "false";
		div.classList.add("flexltr", "commandinput");
		this.imprintName(div);

		const label = document.createElement("span");
		label.textContent =
			this.localizedName + (this.required ? ":" : " " + I18n.commands.optional() + ":");

		const input = document.createElement("input");
		input.type = "file";
		const status = document.createElement("span");
		const uploaded = this.uploadFor(channel, state);
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
			chipBackspace(div, input, channel, e, false);
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
	/** The wire entry: the picked subcommand nesting the leaf entries, inside its group when the
	 * pick is "group/sub". The shape comes from the PICK, not from this chip's class: a command
	 * may mix top-level subcommands and groups, and its one chip is whichever came first. */
	wireEntry(
		state: string,
		leaves: {value: unknown; type: number; name: string}[],
	): {name: string; type: number; options: unknown[]} {
		if (state.includes("/")) {
			const [groupName, subName] = state.split("/");
			return {name: groupName, type: 2, options: [{name: subName, type: 1, options: leaves}]};
		}
		return {name: state, type: 1, options: leaves};
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
		if (div.parentElement) this.owner.boxes.set(channel, div.parentElement);
		const leaves = this.leavesOf(state);
		const states = this.owner.state.get(channel);
		// A leaf the picker re-offers keeps what was typed in it — a channel round-trip (or
		// re-picking the same branch) must not wipe filled values.
		const prior = (leaf: Option) =>
			states?.find((s) => s instanceof Object && s.option === leaf) as {
				state: string;
			} | undefined;
		if (states) {
			const stale = new Set(this.allLeaves());
			const kept = states.filter((s) => typeof s === "string" || !stale.has(s.option));
			for (const leaf of leaves) {
				kept.push({option: leaf, state: prior(leaf)?.state ?? ""});
			}
			this.owner.state.set(channel, kept);
		}
		// Progressive disclosure, same as render(): a filled leaf stays visible; the first
		// unfilled REQUIRED leaf earns a revealed field; optional leaves wait for an explicit
		// pick (the popup previews them).
		let cursor = div;
		let reveal: HTMLElement | undefined;
		for (const leaf of leaves) {
			const value = prior(leaf)?.state ?? "";
			const chip = leaf.toHTML(value, channel);
			chip.classList.add("commandHidden");
			if (leaf.filled(value)) {
				chip.classList.remove("commandHidden");
			} else if (!reveal && leaf.required) {
				reveal = chip;
			}
			cursor.after(chip);
			cursor = chip;
		}
		const box = div.parentElement;
		if (reveal) {
			reveal.classList.remove("commandHidden");
			focusInput(reveal);
		} else if (box) {
			// No required leaf (or none at all): the caret's home is the trailing node, and
			// the popup previews the branch's options. Microtask: this runs inside a popup
			// click, whose handler clears the popup after the pick.
			const node = ensureTrailing(box);
			focusElm(node, false);
			queueMicrotask(() => {
				if (node.isConnected) this.owner.searchAtr(node, channel, box);
			});
		}
	}
	toHTML(state: string, channel: Channel): HTMLElement {
		const div = document.createElement("div");
		div.contentEditable = "false";
		div.classList.add("flexltr", "commandinput");
		this.imprintName(div);

		const input = document.createElement("input");
		input.type = "text";
		// The chip is the command's branch picker: no label of its own (a sibling
		// subcommand's name there read as that subcommand's field), and the picked branch's
		// name stays visible so argument-less branches read as runnable.
		input.placeholder = I18n.commands.placeholderSubcommand();
		input.value = state;
		// A group command picks twice: the group, then its subcommand.
		let group: SubCommandGroupOption | undefined;
		branchShown.set(input, input.value);
		const offer = () => {
			branchShown.set(input, input.value);
			const entries =
				group === undefined
					? this.branches()
					: (group.children.filter((_) => _ instanceof SubCommandOption) as SubCommandOption[]);
			this.owner.localuser.MDSearchOptions(
				entries
					.filter((branch) => branch.localizedName.includes(input.value))
					// Descending: MDSearchOptions prepends each row, so the last entry
					// renders at the top — the list reads A-Z.
					.sort((a, b) => b.localizedName.localeCompare(a.localizedName))
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
									branchShown.set(input, input.value);
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
			chipBackspace(div, input, channel, e);
		};
		input.onkeyup = (e) => {
			chipExit(div, input, this.owner, channel, e);
			if (input.value !== branchShown.get(input)) offer();
		};
		input.oninput = offer;

		div.append(input);
		if (state !== "") {
			queueMicrotask(() => {
				if (div.isConnected) this.renderLeaves(div, state, channel);
			});
		} else {
			// A freshly inserted branch chip offers the choice immediately — no auto-pick of
			// the first subcommand. A pre-pick (the picker's subcommand rows) that landed
			// before this microtask already displays its choice.
			queueMicrotask(() => {
				if (!div.isConnected) return;
				if (this.owner.getState(this, channel)) return;
				input.value = "";
				offer();
			});
		}
		return div;
	}
}
class SubCommandGroupOption extends SubCommandOption {}
