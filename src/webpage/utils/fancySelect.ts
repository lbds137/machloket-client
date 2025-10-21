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
	getHTML() {
		const div = document.createElement("div");
		div.classList.add("fancySelect");
		const input = document.createElement("input");
		input.type = "text";
		div.append(input);

		const options = document.createElement("div");
		options.classList.add("fancyOptions");
		const genArgs = () => {
			Array.from(div.getElementsByClassName("selected")).forEach((_) => _.remove());
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
		const genList = (filter: string) => {
			options.innerHTML = "";
			options.classList.remove("removeElm");
			for (const option of this.options) {
				if (
					!option.label.includes(filter) &&
					!option.description?.includes(filter) &&
					!option.value.includes(filter)
				) {
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
					label.append(option instanceof Function ? option() : option);
				}
				div.append(label);
				if (this.max !== 1) div.append(check);

				div.onmousedown = (e) => {
					if (this.max === 1) {
						input.value = option.label;
						removeAni(options);
					} else {
						e.preventDefault();
						e.stopImmediatePropagation();
						if (!check.checked) {
							let sum = 0;
							for (const thing of this.options) {
								sum += +thing.default;
							}
							if (sum === this.max) return;
						}
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
		};
		input.onblur = async () => {
			removeAni(options);
		};
		input.onkeypress = (e) => {
			if (e.key === "Enter") {
				this.figureSubmit();
			}
		};

		return div;
	}
	onSubmit: (values: string[]) => unknown = () => {};
	private figureSubmit() {
		const stuff = this.options.filter((_) => _.default);
		if (stuff.length < this.min || stuff.length > this.max) {
			return; //TODO error or something?
		}
		this.onSubmit(stuff.map((_) => _.value));
	}
}
