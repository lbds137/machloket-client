import {I18n} from "../i18n.js";
import {removeAni} from "./utils";

interface option {
	value: string;
	label: string;
	description?: string;
	icon?: HTMLElement | (() => HTMLElement);
	default: boolean;
}
export class FancySelect {
	options: option[];
	min: number;
	max: number;
	constructor(options: option[], {min, max} = {min: 1, max: 1}) {
		this.options = options;
		this.min = min;
		this.max = max;
	}
	/** The chosen values when the list last opened (or last sent): closing sends only a change. */
	private openedWith: string[] = [];
	private readonly error = document.createElement("div");
	private chosen() {
		return this.options.filter((_) => _.default).map((_) => _.value);
	}
	getHTML() {
		const div = document.createElement("div");
		div.classList.add("fancySelect");
		const input = document.createElement("input");
		input.type = "text";
		div.append(input);
		this.error.classList.add("fancySelectError");

		const options = document.createElement("div");
		options.classList.add("fancyOptions");
		const genArgs = () => {
			Array.from(div.getElementsByClassName("selected")).forEach((_) => _.remove());
			if (this.max === 1) {
				// One choice reads as the box's placeholder: no chip to clear (a clear couldn't reach the
				// bot), and the box's text stays free to filter the list.
				input.placeholder = this.options.find((_) => _.default)?.label ?? "";
				return;
			}
			for (const option of this.options.toReversed()) {
				if (!option.default) continue;
				const span = document.createElement("span");
				span.classList.add("selected");
				span.textContent = option.label;

				const x = document.createElement("span");
				x.classList.add("svg-x");
				span.prepend(x);
				x.onmousedown = (e) => {
					e.preventDefault();
					e.stopImmediatePropagation();
					input.focus();
					span.remove();
					option.default = false;
					genList(input.value);
				};

				div.prepend(span);
			}
		};
		const genList = (typed: string) => {
			options.innerHTML = "";
			options.classList.remove("removeElm");
			const filter = typed.toLocaleLowerCase();
			const matches = (text: string | undefined) => !!text?.toLocaleLowerCase().includes(filter);
			for (const option of this.options) {
				if (!matches(option.label) && !matches(option.description) && !matches(option.value)) {
					continue;
				}
				const div = document.createElement("div");
				div.classList.add("flexltr");

				const check = document.createElement("input");
				check.type = "checkbox";
				check.checked = option.default;
				check.onclick = (e) => e.preventDefault();

				const label = document.createElement("div");
				label.classList.add("flexttb");
				label.append(option.label);
				if (option.description) {
					const p = document.createElement("p");
					p.textContent = option.description;
					label.append(p);
				}
				if (option.icon) {
					label.append(option.icon instanceof Function ? option.icon() : option.icon);
				}
				div.append(label);
				if (this.max !== 1) div.append(check);

				div.onmousedown = (e) => {
					if (this.max === 1) {
						// One choice: the tap is the answer, as in Discord's select menus.
						e.preventDefault();
						for (const other of this.options) other.default = other === option;
						input.value = "";
						genArgs();
						this.figureSubmit();
						input.blur();
						return;
					} else {
						e.preventDefault();
						e.stopImmediatePropagation();
						if (!check.checked) {
							let sum = 0;
							for (const thing of this.options) {
								sum += +thing.default;
							}
							if (sum === this.max) {
								this.error.textContent = I18n.interactions.modalCount(this.min + "", this.max + "");
								return;
							}
						}
						this.error.textContent = "";
						check.checked = !check.checked;
						option.default = check.checked;
						genArgs();
					}

					input.focus();
				};

				options.append(div);
			}
		};
		genArgs();
		genList(input.value);
		input.oninput = () => {
			genList(input.value);
		};
		input.onfocus = () => {
			options.classList.remove("removeElm");
			div.append(options);
			this.openedWith = this.chosen();
		};
		input.onblur = async () => {
			removeAni(options);
			// Several choices: closing the list is the answer (phones have no reliable Enter here).
			if (this.max !== 1 && this.chosen().join("\n") !== this.openedWith.join("\n")) {
				this.figureSubmit();
			}
		};
		input.onkeypress = (e) => {
			if (e.key === "Enter") {
				this.figureSubmit();
			}
		};

		div.append(this.error);
		return div;
	}
	onSubmit: (values: string[]) => unknown = () => {};
	private figureSubmit() {
		const values = this.chosen();
		if (values.length < this.min || values.length > this.max) {
			this.error.textContent = I18n.interactions.modalCount(this.min + "", this.max + "");
			return;
		}
		this.error.textContent = "";
		this.openedWith = values;
		this.onSubmit(values);
	}
}
