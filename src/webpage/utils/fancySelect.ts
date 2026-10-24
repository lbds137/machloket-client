import {I18n} from "../i18n.js";
import {mobile, removeAni} from "./utils";

interface option {
	value: string;
	label: string;
	description?: string;
	icon?: HTMLElement | (() => HTMLElement);
	default: boolean;
}
export class FancySelect {
	/** Phones open a message select's list as a bottom sheet over a dim backdrop; desktop keeps
	 * the inline overlay list. A phone flag, so tests can drive either path. */
	static phoneMode: boolean = mobile;
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
					// Desktop refocuses so the box keeps filtering; on the phone a focus would open
					// the sheet — the clear stays on the box, a fresh tap on it reopens the sheet.
					if (!FancySelect.phoneMode) input.focus();
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

		// The phone bottom sheet (static phoneMode): the list opens as a fixed sheet over a dim
		// backdrop instead of an overlay on top of the message, with Apply as the only way a
		// multiple choice sends. Desktop (phoneMode false) never builds it.
		const multi = this.max !== 1;
		let sheet: HTMLElement | undefined;
		const openSheet = () => {
			if (sheet?.isConnected) return;
			this.openedWith = this.chosen();

			const backdrop = document.createElement("div");
			backdrop.classList.add("selectSheetBackdrop");
			sheet = document.createElement("div");
			sheet.classList.add("selectSheet");

			const header = document.createElement("div");
			header.classList.add("selectSheetHeader");
			const title = document.createElement("span");
			title.classList.add("selectSheetTitle");
			title.textContent = this.options
				.filter((_) => _.default)
				.map((_) => _.label)
				.join(", ");
			const close = document.createElement("button");
			close.classList.add("selectSheetClose");
			close.textContent = "×";
			header.append(title, close);

			const rows = document.createElement("div");
			rows.classList.add("selectSheetRows");
			const rendered: {option: option; row: HTMLDivElement; check?: HTMLInputElement}[] = [];
			for (const option of this.options) {
				const row = document.createElement("div");
				row.classList.add("selectSheetRow");
				const labelBox = document.createElement("div");
				labelBox.classList.add("flexttb");
				labelBox.append(option.label);
				if (option.description) {
					const p = document.createElement("p");
					p.textContent = option.description;
					labelBox.append(p);
				}
				let check: HTMLInputElement | undefined;
				if (multi) {
					check = document.createElement("input");
					check.type = "checkbox";
					check.classList.add("selectSheetMarker");
					check.onclick = (e) => e.preventDefault();
					row.append(check, labelBox);
				} else {
					const radio = document.createElement("span");
					radio.classList.add("selectSheetMarker", "selectSheetRadio");
					row.append(radio, labelBox);
				}
				row.onclick = () => {
					if (multi) {
						// At the maximum an unselected row's tap is ignored, not answered with an error.
						if (row.classList.contains("selectSheetDisabled")) return;
						option.default = !option.default;
						refresh();
					} else {
						// One choice: the tap is the answer, as in Discord's select menus.
						for (const other of this.options) other.default = other === option;
						input.value = "";
						genArgs();
						this.figureSubmit();
						closeSheet();
					}
				};
				rendered.push({option, row, check});
				rows.append(row);
			}
			sheet.append(header, rows, this.error);

			const count = document.createElement("span");
			count.classList.add("selectSheetCount");
			const apply = document.createElement("button");
			apply.classList.add("selectSheetApply");
			apply.textContent = I18n.interactions.sheetApply();
			apply.onclick = () => {
				this.figureSubmit();
				// Outside min..max: the reason shows in the sheet and it stays open.
				if (this.error.textContent !== "") return;
				closeSheet();
			};
			const refresh = () => {
				const chosen = this.chosen();
				for (const {option, row, check} of rendered) {
					if (check) check.checked = option.default;
					row.classList.toggle("selectSheetSelected", option.default);
					row.classList.toggle(
						"selectSheetDisabled",
						multi && chosen.length === this.max && !option.default,
					);
				}
				count.textContent = I18n.interactions.sheetCount(chosen.length + "");
				apply.disabled = chosen.length < this.min;
			};
			if (multi) {
				const footer = document.createElement("div");
				footer.classList.add("selectSheetFooter");
				footer.append(count, apply);
				sheet.append(footer);
			}

			const closeSheet = () => {
				disarmOpenClick();
				document.removeEventListener("keydown", esc);
				backdrop.remove();
				sheet = undefined;
				div.append(this.error);
			};
			const discard = () => {
				// Closing without Apply is a discard: every option returns to what it was when the
				// sheet opened, and nothing is sent.
				for (const option of this.options) option.default = this.openedWith.includes(option.value);
				genArgs();
				closeSheet();
			};
			close.onclick = discard;
			backdrop.onclick = (e) => {
				if (e.target !== backdrop) return;
				discard();
			};
			const esc = (e: KeyboardEvent) => {
				if (e.key === "Escape") discard();
			};
			document.addEventListener("keydown", esc);

			backdrop.append(sheet);
			document.body.append(backdrop);
			refresh();

			// The opening tap's own release lands wherever the sheet just slid — under
			// the finger sat a row (or the backdrop), and its click would answer or
			// discard before the user ever chose. Swallow exactly that one click: a new
			// gesture disarms the swallow (a pointerdown, or a keydown from keyboard or
			// assistive-tech activation), and closeSheet cleans up behind it.
			let swallowOpenClick: ((e: MouseEvent) => void) | undefined;
			const disarmOpenClick = () => {
				if (!swallowOpenClick) return;
				document.removeEventListener("click", swallowOpenClick, true);
				document.removeEventListener("pointerdown", disarmOpenClick, true);
				document.removeEventListener("keydown", disarmOpenClick, true);
				swallowOpenClick = undefined;
			};
			swallowOpenClick = (e) => {
				disarmOpenClick();
				if (!backdrop.isConnected) return;
				if (backdrop.contains(e.target as Node)) {
					e.preventDefault();
					e.stopImmediatePropagation();
				}
			};
			document.addEventListener("click", swallowOpenClick, true);
			document.addEventListener("pointerdown", disarmOpenClick, true);
			document.addEventListener("keydown", disarmOpenClick, true);
		};

		input.onpointerdown = (e) => {
			if (!FancySelect.phoneMode) return;
			// The tap opens the sheet; preventing the default keeps the on-screen keyboard shut.
			e.preventDefault();
			openSheet();
		};
		input.oninput = () => {
			genList(input.value);
		};
		input.onfocus = () => {
			if (FancySelect.phoneMode) {
				openSheet();
				// A tap that still focused the box (a real browser can) must not leave its keyboard
				// up under the sheet.
				input.blur();
				return;
			}
			options.classList.remove("removeElm");
			div.append(options);
			this.openedWith = this.chosen();
		};
		input.onblur = async () => {
			// On the sheet the only send is Apply; closing discards (and the box never focused).
			if (FancySelect.phoneMode) return;
			removeAni(options);
			// Several choices: closing the list is the answer (phones have no reliable Enter here).
			if (this.max !== 1 && this.chosen().join("\n") !== this.openedWith.join("\n")) {
				this.figureSubmit();
			}
		};
		input.onkeypress = (e) => {
			if (FancySelect.phoneMode) return;
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
