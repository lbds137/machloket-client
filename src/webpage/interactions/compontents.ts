import {Channel} from "../channel.js";
import {I18n} from "../i18n.js";
import {actionRow, button, component, select} from "../jsontypes.js";
import {MarkDown} from "../markdown";
import {Message} from "../message.js";
import {FancySelect} from "../utils/fancySelect.js";
abstract class compObj {
	abstract owner: Components;
	abstract getHTML(): HTMLElement;
	get info() {
		return this.owner.owner.info;
	}
	get message() {
		return this.owner.owner instanceof Message ? this.owner.owner : undefined;
	}
	get channel() {
		return this.owner.owner instanceof Message ? this.owner.owner.channel : this.owner.owner;
	}
	get guild() {
		return this.owner.owner.guild;
	}
	get headers() {
		return this.owner.owner.headers;
	}
	get bot() {
		return this.message!.author;
	}
	get localuser() {
		return this.owner.owner.localuser;
	}
}
export class Components {
	components: compObj[];
	owner: Message | Channel;
	constructor(components: component[], message: Message | Channel) {
		this.owner = message;
		this.components = components.map((comp) => this.toComp(comp));
	}
	toComp(comp: component): compObj {
		switch (comp.type) {
			case 1:
				return new ActionRow(comp, this);
			case 2:
				return new Button(comp, this);
			case 3:
				return new Select(comp, this);
			default:
				return new ErrorElm(comp, this);
		}
	}
	getHTML() {
		const div = document.createElement("div");
		div.classList.add("flexttb");
		div.append(...this.components.map((_) => _.getHTML()));
		return div;
	}
}
class ActionRow extends compObj {
	components: compObj[];
	owner: Components;
	constructor(comp: actionRow, owner: Components) {
		super();
		this.owner = owner;
		this.components = comp.components.map((comp) => owner.toComp(comp));
	}
	getHTML() {
		const div = document.createElement("div");
		div.classList.add("flexltr");
		div.append(...this.components.map((_) => _.getHTML()));
		return div;
	}
}
class Button extends compObj {
	custom_id: string;
	label?: string;
	url?: string;
	style: 1 | 2 | 3 | 4 | 5 | 6;
	owner: Components;
	disabled: boolean;
	constructor(comp: button, owner: Components) {
		super();
		console.warn(comp);
		this.custom_id = comp.custom_id;
		this.label = comp.label;
		this.style = comp.style;
		this.owner = owner;
		this.disabled = comp.disabled || false;
		this.url = comp.url;
	}
	get styleVar() {
		return [
			"buttonPrimary",
			"buttonSecondary",
			"buttonSuccess",
			"buttonDanger",
			"buttonLink",
			"buttonPremium",
		][this.style - 1];
	}
	async clickEvent() {
		const nonce = Math.floor(Math.random() * 10 ** 9) + "";
		if (this.message) this.localuser.registerInterNonce(nonce, this.message);
		await fetch(this.info.api + "/interactions", {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify({
				type: this.message ? 3 : 5,
				nonce: nonce,
				guild_id: this.guild.id,
				channel_id: this.channel.id,
				message_flags: this.message?.flags,
				message_id: this.message?.id,
				application_id: this.bot.id,
				session_id: this.localuser.session_id,
				data: {
					component_type: 2,
					custom_id: this.custom_id,
				},
			}),
		});
	}
	getHTML() {
		const button = document.createElement("button");
		if (this.label) {
			button.textContent = this.label;
		}
		if (!this.disabled) {
			if (this.url) {
				MarkDown.safeLink(button, this.url, this.localuser);
			} else {
				button.onclick = () => {
					this.clickEvent();
				};
			}
		}
		button.disabled = this.disabled;
		button.classList.add(this.styleVar, "interButton");
		return button;
	}
}
class ErrorElm extends compObj {
	comp: component;
	owner: Components;
	constructor(comp: component, owner: Components) {
		super();
		this.comp = comp;
		this.owner = owner;
	}
	getHTML(): HTMLElement {
		const span = document.createElement("span");
		if (this.comp.type < 1 && this.comp.type > 20) {
			span.textContent = I18n.interactions.notImpl(this.comp.type + "");
		} else {
			span.textContent = I18n.interactions.nonsence(this.comp.type + "");
		}
		return span;
	}
}
class Select extends compObj {
	custom_id: string;
	owner: Components;
	options: select["options"];
	maxValues: number;
	minValues: number;
	constructor(comp: select, owner: Components) {
		super();
		this.owner = owner;
		this.custom_id = comp.custom_id;
		this.options = comp.options;
		this.maxValues = comp.max_values || 1;
		this.minValues = comp.min_values || 1;
	}
	async submit(values: string[]) {
		const nonce = Math.floor(Math.random() * 10 ** 9) + "";
		if (this.message) this.localuser.registerInterNonce(nonce, this.message);
		await fetch(this.info.api + "/interactions", {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify({
				type: this.message ? 3 : 5,
				nonce: nonce,
				guild_id: this.guild.id,
				channel_id: this.channel.id,
				message_flags: this.message?.flags,
				message_id: this.message?.id,
				application_id: this.bot.id,
				session_id: this.localuser.session_id,
				data: {
					component_type: 3,
					custom_id: this.custom_id,
					values,
				},
			}),
		});
	}
	getHTML() {
		const fancy = new FancySelect(
			this.options.map((_) => {
				return {
					label: _.label,
					value: _.value,
					description: _.description,
					default: _.default || false,
				};
			}),
			{max: this.maxValues, min: this.minValues},
		);
		fancy.onSubmit = (list) => {
			this.submit(list);
		};

		return fancy.getHTML();
	}
}
