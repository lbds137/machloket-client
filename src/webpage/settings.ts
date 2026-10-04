import {
	checkInstance,
	getDefaultInstanceUrl,
	getInstances,
	isInstanceListLoaded,
	instancefetch,
	InstanceInfo,
	removeAni,
} from "./utils/utils.js";
import {Emoji} from "./emoji.js";
import {I18n} from "./i18n.js";
import {Localuser} from "./localuser.js";
import {MarkDown} from "./markdown.js";

interface OptionsElement<x> {
	generateHTML(): HTMLElement;
	submit: () => void;
	readonly watchForChange: (func: (arg1: x) => void) => void;
	value: x;
}
//future me stuff
export class Buttons implements OptionsElement<unknown> {
	readonly name: string;
	readonly buttons: [string, Options | string, string?][];
	readonly sectionHeaders = new Map<number, string>();
	readonly buttonMap = new Map<Options | string, HTMLElement>();
	buttonList!: HTMLDivElement;
	warndiv!: HTMLElement;
	value: unknown;
	top = false;
	titles = true;
	_sectionContentDiv: HTMLElement | null = null;
	_activeSection: string | null = null;
	_backButton: HTMLElement | null = null;
	constructor(name: string, {top = false, titles = true} = {}) {
		this.top = top;
		this.buttons = [];
		this.name = name;
		this.titles = titles;
	}
	add(name: string, thing?: Options | undefined, icon?: string) {
		if (!thing) {
			thing = new Options(this.titles ? name : "", this);
		}
		const button = [name, thing, icon] as [string, string | Options, string?];
		this.buttons.push(button);
		const htmlarea = this.htmlarea.deref();
		const buttonTable = this.buttonTable.deref();
		if (buttonTable && htmlarea && !this.sectionHeaders.size) {
			buttonTable.append(this.makeButtonHTML(button, htmlarea));
		}
		return thing;
	}
	addSection(name: string) {
		const index = this.buttons.length;
		this.sectionHeaders.set(index, name);
		const buttonTable = this.buttonTable.deref();
		if (buttonTable && this.sectionHeaders.size <= 1) {
			buttonTable.innerHTML = "";
		}
	}
	htmlarea = new WeakRef(document.createElement("div"));
	buttonTable = new WeakRef(document.createElement("div"));
	generateHTML(hideButtons = false) {
		const buttonList = document.createElement("div");
		buttonList.classList.add("Buttons");
		buttonList.classList.add(this.top ? "flexttb" : "flexltr");
		this.buttonList = buttonList;
		const htmlarea = document.createElement("div");
		htmlarea.classList.add("flexgrow", "settingsHTMLArea");
		if (window.innerWidth <= 1012 && !hideButtons) htmlarea.classList.add("mobileHidden");
		const buttonTable = this.generateButtons(htmlarea);
		this.htmlarea = new WeakRef(htmlarea);
		this.buttonTable = new WeakRef(buttonTable);
		if (this.buttons[0]) {
			if (this.sectionHeaders.size) {
				const firstSection = this._sectionNames()[0];
				if (firstSection) this._renderSection(firstSection, htmlarea);
			} else {
				this.generateHTMLArea(this.buttons[0][1], htmlarea);
			}
		}
		if (!hideButtons) buttonList.append(buttonTable);
		buttonList.append(htmlarea);
		return buttonList;
	}
	makeButtonHTML(buttond: [string, string | Options, string?], optionsArea: HTMLElement) {
		const button = document.createElement("button");
		this.buttonMap.set(buttond[1], button);
		button.classList.add("SettingsButton");
		if (buttond[2]) {
			const icon = document.createElement("span");
			icon.classList.add("svgicon", buttond[2], "sbtn-icon");
			button.append(icon);
		}
		const label = document.createElement("span");
		label.textContent = buttond[0];
		button.append(label);
		button.onclick = (_) => {
			this.generateHTMLArea(buttond[1], optionsArea);
			optionsArea.classList.remove("mobileHidden");
			if (this.warndiv) {
				this.warndiv.remove();
			}
			if (window.innerWidth <= 1012) {
				button.closest(".settingbuttons")?.classList.add("mobileHidden");
				this._showMobileBack();
			}
		};
		return button;
	}
	makeSectionHeaderHTML(text: string) {
		const header = document.createElement("button");
		header.classList.add("SettingsButton", "sectionHeader");
		header.textContent = text;
		header.dataset.section = text;
		return header;
	}
	_sectionNames(): string[] {
		const names: string[] = [];
		for (const [, name] of this.sectionHeaders) {
			if (!names.includes(name)) names.push(name);
		}
		return names;
	}
	_sectionButtons(sectionName: string): [string, Options | string, string?][] {
		const result: [string, Options | string, string?][] = [];
		let startIdx = -1;
		let endIdx = this.buttons.length;
		for (const [idx, name] of this.sectionHeaders) {
			if (name === sectionName) {
				startIdx = idx;
			} else if (startIdx >= 0) {
				endIdx = idx;
				break;
			}
		}
		for (let i = startIdx; i < endIdx && i < this.buttons.length; i++) {
			result.push(this.buttons[i]);
		}
		return result;
	}
	_addAllCardLinks(sidebar: HTMLElement, optionsArea: HTMLElement) {
		const sections = this._sectionNames();
		for (const sectionName of sections) {
			const header = sidebar.querySelector<HTMLElement>(
				`.sectionHeader[data-section="${sectionName}"]`,
			);
			if (!header) continue;
			const buttons = this._sectionButtons(sectionName);
			let insertAfter: HTMLElement | null = header;
			for (const btn of buttons) {
				const [name] = btn;
				const cardId = "card-" + name.replace(/\s+/g, "-").toLowerCase();
				const link = document.createElement("button");
				link.classList.add("SettingsButton", "cardLink");
				link.dataset.section = sectionName;
				const label = document.createElement("span");
				label.textContent = name;
				link.append(label);
				link.onclick = () => {
					if (this._activeSection !== sectionName) {
						sidebar
							.querySelectorAll(".sectionHeader")
							.forEach((el) => el.classList.remove("activeSetting"));
						header.classList.add("activeSetting");
						if (this.warndiv) this.warndiv.remove();
						this._renderSection(sectionName, optionsArea);
					}
					if (window.innerWidth <= 1012) {
						sidebar.classList.add("mobileHidden");
						optionsArea.classList.remove("mobileHidden");
						this._showMobileBack();
						requestAnimationFrame(() => {
							document.getElementById(cardId)?.scrollIntoView({behavior: "smooth", block: "start"});
						});
						return;
					}
					requestAnimationFrame(() => {
						document.getElementById(cardId)?.scrollIntoView({behavior: "smooth", block: "start"});
					});
				};
				if (insertAfter) {
					insertAfter.insertAdjacentElement("afterend", link);
					insertAfter = link;
				}
			}
		}
	}
	_renderSection(sectionName: string, htmlarea: HTMLElement) {
		const buttons = this._sectionButtons(sectionName);
		if (!buttons.length) return;

		this._activeSection = sectionName;
		htmlarea.innerHTML = "";

		const titlediv = document.createElement("div");
		titlediv.classList.add("titlediv", "flexttb");

		const grid = document.createElement("div");
		grid.classList.add("settingsGrid");

		for (const btn of buttons) {
			const [name, thing] = btn;
			if (thing instanceof Options) {
				thing.subOptions = undefined;
				const cardId = "card-" + name.replace(/\s+/g, "-").toLowerCase();
				const card = document.createElement("div");
				card.classList.add("settingsCard");
				card.id = cardId;
				if (thing.ltr || (thing as any)._fullWidth) card.classList.add("settingsCardWide");
				card.append(thing.generateHTML());
				grid.append(card);
			}
		}

		titlediv.append(grid);
		htmlarea.append(titlediv);
	}
	generateButtons(optionsArea: HTMLElement) {
		const buttonTable = document.createElement("div");
		buttonTable.classList.add("settingbuttons");
		if (this.sectionHeaders.size) {
			buttonTable.classList.add("groupedSettings");
		}
		if (this.top) {
			buttonTable.classList.add("flexltr");
		}
		if (this.sectionHeaders.size) {
			const fb = document.createElement("a");
			fb.textContent = "Give feedback about this design";
			fb.href = "https://github.com/lbds137/machloket-client/issues";
			fb.target = "_blank";
			fb.rel = "noopener noreferrer";
			fb.classList.add("settingsFeedback");
			buttonTable.append(fb);
		}
		if (this.sectionHeaders.size) {
			const sections = this._sectionNames();
			for (const name of sections) {
				const header = this.makeSectionHeaderHTML(name);
				header.onclick = () => {
					if (this.warndiv) this.warndiv.remove();
					buttonTable
						.querySelectorAll(".sectionHeader")
						.forEach((el) => el.classList.remove("activeSetting"));
					header.classList.add("activeSetting");
					this._renderSection(name, optionsArea);
					if (window.innerWidth <= 1012) {
						buttonTable.classList.add("mobileHidden");
						optionsArea.classList.remove("mobileHidden");
						this._showMobileBack();
					}
				};
				buttonTable.append(header);
			}
			if (sections[0]) {
				buttonTable.querySelector(".sectionHeader")?.classList.add("activeSetting");
			}
			this._addAllCardLinks(buttonTable, optionsArea);
		} else {
			for (let i = 0; i < this.buttons.length; i++) {
				const thing = this.buttons[i];
				buttonTable.append(this.makeButtonHTML(thing, optionsArea));
			}
		}
		this._initKeyboardNav(buttonTable);
		return buttonTable;
	}
	private _initKeyboardNav(container: HTMLElement) {
		container.addEventListener("keydown", (e) => {
			const navItems = container.querySelectorAll<HTMLElement>(".SettingsButton");
			if (!navItems.length) return;
			const current = container.querySelector<HTMLElement>(".activeSetting") || navItems[0];
			let idx = Array.from(navItems).indexOf(current);
			if (e.key === "ArrowDown") {
				e.preventDefault();
				idx = (idx + 1) % navItems.length;
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				idx = (idx - 1 + navItems.length) % navItems.length;
			} else if (e.key === "Home") {
				e.preventDefault();
				idx = 0;
			} else if (e.key === "End") {
				e.preventDefault();
				idx = navItems.length - 1;
			} else {
				return;
			}
			navItems[idx].focus();
			navItems[idx].click();
		});
	}
	handleString(str: string): HTMLElement {
		const div = document.createElement("span");
		div.textContent = str;
		return div;
	}
	_showMobileBack() {
		if (window.innerWidth > 1012) return;
		if (this._backButton) this._backButton.style.display = "";
	}
	_hideMobileBack() {
		if (this._backButton) this._backButton.style.display = "none";
	}
	last?: Options | string;
	generateHTMLArea(buttonInfo: Options | string, htmlarea: HTMLElement) {
		if (this.last) {
			const elm = this.buttonMap.get(this.last);
			if (elm) {
				elm.classList.remove("activeSetting");
			}
		}
		this.last = buttonInfo;
		const elm = this.buttonMap.get(buttonInfo);
		if (elm) {
			elm.classList.add("activeSetting");
		}
		let html: HTMLElement;
		if (buttonInfo instanceof Options) {
			buttonInfo.subOptions = undefined;
			html = buttonInfo.generateHTML();
		} else {
			html = this.handleString(buttonInfo);
		}

		htmlarea.innerHTML = "";
		htmlarea.append(html);

		return html;
	}
	changed(html: HTMLElement) {
		this.warndiv = html;
		document.body.append(html);
	}
	watchForChange() {}
	save() {}
	submit() {}
}

class TextInput implements OptionsElement<string> {
	readonly label: string;
	readonly owner: Options;
	readonly onSubmit: (str: string) => void;
	value: string;
	input!: WeakRef<HTMLInputElement>;
	password: boolean;
	spaceReplace: string;
	constructor(
		label: string,
		onSubmit: (str: string) => void,
		owner: Options,
		{initText = "", password = false, spaceReplace = " "} = {},
	) {
		this.label = label;
		this.value = initText;
		this.owner = owner;
		this.onSubmit = onSubmit;
		this.password = password;
		this.spaceReplace = spaceReplace;
	}
	generateHTML(): HTMLDivElement {
		const div = document.createElement("div");
		const span = document.createElement("span");
		span.textContent = this.label;
		div.append(span);
		const input = document.createElement("input");
		input.value = this.value;
		input.type = this.password ? "password" : "text";
		input.oninput = this.onChange.bind(this);
		this.input = new WeakRef(input);
		div.append(input);
		return div;
	}
	onChange() {
		this.owner.changed();
		const input = this.input.deref();
		if (input) {
			// Replaced on input, not keyup: a paste, a touch keyboard or the last keystroke
			// otherwise kept its spaces in the stored value.
			if (this.spaceReplace !== " " && input.value.includes(" ")) {
				const caret = input.selectionStart;
				const before = caret === null ? "" : input.value.slice(0, caret).replace(/ /g, this.spaceReplace);
				input.value = input.value.replace(/ /g, this.spaceReplace);
				if (caret !== null) input.setSelectionRange(before.length, before.length);
			}
			const value = input.value as string;
			this.onchange(value);
			this.value = value;
		}
	}
	onchange: (str: string) => void = (_) => {};
	watchForChange(func: (str: string) => void) {
		this.onchange = func;
	}
	submit() {
		this.onSubmit(this.value);
	}
}
class DateInput extends TextInput {
	dateValue: Date | null;
	constructor(
		label: string,
		onSubmit: (str: string) => void,
		owner: Options,
		{initText = "" as string | Date} = {},
	) {
		let initDate: DateInput["dateValue"] = null;
		if (initText instanceof Date) {
			initDate = initText;
			initText = "";
		}
		super(label, onSubmit, owner, {initText});
		this.dateValue = initDate;
	}
	generateHTML(): HTMLDivElement {
		const div = document.createElement("div");
		const span = document.createElement("span");
		span.textContent = this.label;
		div.append(span);
		const input = document.createElement("input");
		input.value = this.value;
		input.type = "date";
		if (this.dateValue) input.valueAsDate = this.dateValue;
		input.oninput = this.onChange.bind(this);
		this.input = new WeakRef(input);
		div.append(input);
		return div;
	}
	onChange() {
		const input = this.input.deref();
		if (input) {
			const value = input.valueAsDate;
			this.dateValue = value;
		}
		super.onChange();
	}
}
class SettingsMDText implements OptionsElement<void> {
	readonly onSubmit!: (str: string) => void;
	value!: void;
	text: MarkDown;
	elm!: WeakRef<HTMLSpanElement>;
	constructor(text: MarkDown) {
		this.text = text;
	}
	generateHTML(): HTMLSpanElement {
		const span = document.createElement("span");
		this.elm = new WeakRef(span);
		this.setText(this.text);
		return span;
	}
	setText(text: MarkDown) {
		this.text = text;
		if (this.elm) {
			const span = this.elm.deref();
			if (span) {
				span.innerHTML = "";

				span.append(text.makeHTML());
			}
		}
	}
	watchForChange() {}
	submit() {}
}

class SettingsText implements OptionsElement<void> {
	readonly onSubmit!: (str: string) => void;
	value!: void;
	readonly text: string;
	elm!: WeakRef<HTMLSpanElement>;
	constructor(text: string) {
		this.text = text;
	}
	generateHTML(): HTMLSpanElement {
		const span = document.createElement("span");
		span.innerText = this.text;
		this.elm = new WeakRef(span);
		return span;
	}
	setText(text: string) {
		if (this.elm) {
			const span = this.elm.deref();
			if (span) {
				span.innerText = text;
			}
		}
	}
	watchForChange() {}
	submit() {}
}
class SettingsTitle implements OptionsElement<void> {
	readonly onSubmit!: (str: string) => void;
	value!: void;
	readonly text: string;
	constructor(text: string) {
		this.text = text;
	}
	generateHTML(): HTMLSpanElement {
		const span = document.createElement("h2");
		span.innerText = this.text;
		return span;
	}
	watchForChange() {}
	submit() {}
}
class CheckboxInput implements OptionsElement<boolean> {
	readonly label: string;
	readonly owner: Options;
	readonly onSubmit: (str: boolean) => void;
	value: boolean;
	input!: WeakRef<HTMLInputElement>;
	constructor(
		label: string,
		onSubmit: (str: boolean) => void,
		owner: Options,
		{initState = false} = {},
	) {
		this.label = label;
		this.value = initState;
		this.owner = owner;
		this.onSubmit = onSubmit;
	}
	generateHTML(): HTMLDivElement {
		const div = document.createElement("div");
		const span = document.createElement("span");
		span.textContent = this.label;
		div.append(span);
		const input = document.createElement("input");
		input.type = "checkbox";
		input.checked = this.value;
		input.oninput = this.onChange.bind(this);
		this.input = new WeakRef(input);
		div.append(input);
		return div;
	}
	private onChange() {
		this.owner.changed();
		const input = this.input.deref();
		if (input) {
			const value = input.checked as boolean;
			this.value = value;
			this.onchange(value);
		}
	}
	setState(state: boolean) {
		if (this.input) {
			const checkbox = this.input.deref();
			if (checkbox) {
				checkbox.checked = state;
				this.value = state;
			}
		}
	}
	onchange: (str: boolean) => void = (_) => {};
	watchForChange(func: (str: boolean) => void) {
		this.onchange = func;
	}
	submit() {
		this.onSubmit(this.value);
	}
}

class ButtonInput implements OptionsElement<void> {
	readonly label: string;
	readonly owner: Options;
	readonly onClick: () => void;
	private _textContent: string;
	value!: void;
	constructor(label: string, textContent: string, onClick: () => void, owner: Options, {} = {}) {
		this.label = label;
		this.owner = owner;
		this.onClick = onClick;
		this._textContent = textContent;
	}
	buttonHtml?: HTMLButtonElement;
	get textContent() {
		return this._textContent;
	}
	set textContent(textContent: string) {
		this._textContent = textContent;
		if (this.buttonHtml) {
			this.buttonHtml.textContent = textContent;
		}
	}
	generateHTML(): HTMLDivElement {
		const div = document.createElement("div");
		if (this.label) {
			const span = document.createElement("span");
			span.classList.add("inlinelabel");
			span.textContent = this.label;
			div.append(span);
		}
		const button = document.createElement("button");
		button.textContent = this._textContent;
		button.onclick = this.onClickEvent.bind(this);
		this.buttonHtml = button;
		div.append(button);
		return div;
	}
	private onClickEvent() {
		this.onClick();
	}
	watchForChange() {}
	submit() {}
}

export class ColorInput implements OptionsElement<string> {
	readonly label: string;
	readonly owner: Options;
	readonly onSubmit: (str: string) => void;
	colorContent: string;
	input!: WeakRef<HTMLInputElement>;
	value: string;
	constructor(
		label: string,
		onSubmit: (str: string) => void,
		owner: Options,
		{initColor = "#000000"} = {},
	) {
		this.label = label;
		this.colorContent = initColor;
		this.value = initColor;
		this.owner = owner;
		this.onSubmit = onSubmit;
	}
	generateHTML(): HTMLDivElement {
		const div = document.createElement("div");
		const span = document.createElement("span");
		span.textContent = this.label;
		div.append(span);
		const input = document.createElement("input");
		input.value = this.colorContent;
		input.type = "color";
		input.oninput = this.onChange.bind(this);
		this.input = new WeakRef(input);
		div.append(input);
		return div;
	}
	private onChange() {
		this.owner.changed();
		const input = this.input.deref();
		if (input) {
			const value = input.value as string;
			this.value = value;
			this.onchange(value);
			this.colorContent = value;
		}
	}
	onchange: (str: string) => void = (_) => {};
	watchForChange(func: (str: string) => void) {
		this.onchange = func;
	}
	submit() {
		this.onSubmit(this.colorContent);
	}
}
interface searchRes {
	value: string;
	name: string;
}
class AsyncMultiSelect implements OptionsElement<string[]> {
	readonly label: string;
	readonly owner: Options;
	readonly onSubmit: (str: string[]) => void;
	select!: WeakRef<HTMLSelectElement>;
	searchFunc: (term: string, cur: string[]) => Promise<searchRes[]> | searchRes[];
	value = [] as string[];
	nmap = [] as string[];
	constructor(
		label: string,
		onSubmit: (str: string[]) => void,
		selections: AsyncMultiSelect["searchFunc"],
		owner: Options,
		{defaultValues = []}: {defaultValues: searchRes[]} = {defaultValues: []},
	) {
		this.label = label;
		this.value = defaultValues.map((_) => _.value);
		this.nmap = defaultValues.map((_) => _.name);
		this.owner = owner;
		this.onSubmit = onSubmit;
		this.searchFunc = selections;
	}
	generateHTML() {
		const div = document.createElement("div");
		const span = document.createElement("span");
		span.textContent = this.label;
		div.append(span);
		const s = document.createElement("div");
		s.classList.add("amsCont");
		const genArea = () => {
			s.textContent = "";
			let i = 0;
			for (const name of this.nmap) {
				const si = i++;
				const elm = document.createElement("div");
				elm.classList.add("amsElm", "flexltr");

				const x = document.createElement("span");
				x.classList.add("svgicon", "svg-plainx");
				x.onclick = () => {
					this.value.splice(si, 1);
					this.nmap.splice(si, 1);
					genArea();
					this.onchange(this.value);
				};
				const nspan = document.createElement("span");
				nspan.textContent = name;

				elm.append(nspan, x);

				s.append(elm);
			}
			const addbg = document.createElement("div");
			addbg.classList.add("addbg");
			const add = document.createElement("span");
			add.classList.add("svgicon", "svg-plus");
			addbg.append(add);
			s.append(addbg);
			add.onclick = (e) => {
				this.popUpSearchBox(e.x, e.y, () => {
					genArea();
					this.onchange(this.value);
				});
			};
		};
		genArea();
		div.append(s);
		return div;
	}
	async popUpSearchBox(x: number, y: number, done: () => void) {
		const searchBox = document.createElement("div");
		searchBox.style.top = y + "px";
		searchBox.style.left = x + "px";
		searchBox.classList.add("amsBox");
		const input = document.createElement("input");
		input.type = "text";

		const reses = document.createElement("div");
		reses.classList.add("flexttb", "reses");
		searchBox.append(input, reses);
		let opts = [] as searchRes[];
		const search = async () => {
			const res = await this.searchFunc(input.value || "", this.value);
			reses.textContent = "";
			opts = res;
			for (const opt of opts) {
				const span = document.createElement("span");
				span.textContent = opt.name;
				span.onmousedown = () => {
					removeAni(searchBox);
					this.value.push(opt.value);
					this.nmap.push(opt.name);
					done();
				};
				reses.append(span);
			}
			input.onblur = async () => {
				removeAni(searchBox);
			};
		};

		input.onkeyup = (e) => {
			if (e.key === "Enter" && opts[0]) {
				removeAni(searchBox);
				this.value.push(opts[0].value);
				this.nmap.push(opts[0].name);
				done();
			} else {
				search();
			}
		};

		search();
		document.body.append(searchBox);
		input.focus();
	}
	submit() {
		this.onSubmit(this.value);
	}
	onchange: (str: string[]) => void = (_) => {};
	watchForChange(func: (str: string[]) => void) {
		this.onchange = func;
	}
}
class SelectInput implements OptionsElement<number> {
	readonly label: string;
	readonly owner: Options;
	readonly onSubmit: (str: number) => void;
	options: readonly string[];
	index: number;
	select!: WeakRef<HTMLSelectElement>;
	radio: boolean;
	get value() {
		return this.index;
	}
	constructor(
		label: string,
		onSubmit: (str: number) => void,
		options: readonly string[],
		owner: Options,
		{defaultIndex = 0, radio = false} = {},
	) {
		this.label = label;
		this.index = defaultIndex;
		this.owner = owner;
		this.onSubmit = onSubmit;
		this.options = options;
		this.radio = radio;
	}
	generateHTML(): HTMLDivElement {
		if (this.radio) {
			const map = new WeakMap<HTMLInputElement, number>();
			const div = document.createElement("div");
			const fieldset = document.createElement("fieldset");
			fieldset.addEventListener("change", () => {
				let i = -1;
				for (const thing of Array.from(fieldset.children)) {
					i++;
					if (i === 0) {
						continue;
					}
					const checkbox = thing.children[0].children[0] as HTMLInputElement;
					if (checkbox.checked) {
						this.onChange(map.get(checkbox));
					}
				}
			});
			const legend = document.createElement("legend");
			legend.textContent = this.label;
			fieldset.appendChild(legend);
			let i = 0;
			for (const thing of this.options) {
				const div = document.createElement("div");
				const input = document.createElement("input");
				input.classList.add("radio");
				input.type = "radio";
				input.name = this.label;
				input.value = thing;
				map.set(input, i);
				if (i === this.index) {
					input.checked = true;
				}
				const label = document.createElement("label");

				label.appendChild(input);
				const span = document.createElement("span");
				span.textContent = thing;
				label.appendChild(span);
				div.appendChild(label);
				fieldset.appendChild(div);
				i++;
			}
			div.appendChild(fieldset);
			return div;
		}
		const div = document.createElement("div");
		const span = document.createElement("span");
		span.textContent = this.label;
		div.append(span);
		const selectSpan = document.createElement("span");
		selectSpan.classList.add("selectspan");
		const select = document.createElement("select");

		select.onchange = this.onChange.bind(this, -1);
		for (const thing of this.options) {
			const option = document.createElement("option");
			option.textContent = thing;
			select.appendChild(option);
		}
		this.select = new WeakRef(select);
		select.selectedIndex = this.index;
		selectSpan.append(select);
		const selectArrow = document.createElement("span");
		selectArrow.classList.add("svgicon", "svg-category", "selectarrow");
		selectSpan.append(selectArrow);
		div.append(selectSpan);
		return div;
	}
	private onChange(index = -1) {
		this.owner.changed();
		if (index !== -1) {
			this.index = index;
			this.onchange(index);
			return;
		}
		const select = this.select.deref();
		if (select) {
			const value = select.selectedIndex;
			this.onchange(value);
			this.index = value;
		}
	}
	onchange: (str: number) => void = (_) => {};
	watchForChange(func: (str: number) => void) {
		this.onchange = func;
	}
	submit() {
		this.onSubmit(this.index);
	}
}
class MDInput implements OptionsElement<string> {
	readonly label: string;
	readonly owner: Options;
	readonly onSubmit: (str: string) => void;
	value: string;
	input!: WeakRef<HTMLTextAreaElement>;
	constructor(
		label: string,
		onSubmit: (str: string) => void,
		owner: Options,
		{initText = ""} = {},
	) {
		this.label = label;
		this.value = initText;
		this.owner = owner;
		this.onSubmit = onSubmit;
	}
	generateHTML(): HTMLDivElement {
		const div = document.createElement("div");
		const span = document.createElement("span");
		span.textContent = this.label;
		div.append(span);
		div.append(document.createElement("br"));
		const input = document.createElement("textarea");
		input.value = this.value;
		input.oninput = this.onChange.bind(this);
		this.input = new WeakRef(input);
		div.append(input);
		return div;
	}
	onChange() {
		this.owner.changed();
		const input = this.input.deref();
		if (input) {
			const value = input.value as string;
			this.onchange(value);
			this.value = value;
		}
	}
	onchange: (str: string) => void = (_) => {};
	watchForChange(func: (str: string) => void) {
		this.onchange = func;
	}
	submit() {
		this.onSubmit(this.value);
	}
}
class EmojiInput implements OptionsElement<Emoji | undefined | null> {
	readonly label: string;
	readonly owner: Options;
	readonly onSubmit: (str: Emoji | undefined | null) => void;
	input!: WeakRef<HTMLInputElement>;
	value!: Emoji | undefined | null;
	localuser: Localuser;
	clear: boolean;
	guild: boolean;
	constructor(
		label: string,
		onSubmit: (str: Emoji | undefined | null) => void,
		owner: Options,
		localuser: Localuser,
		{
			initEmoji = undefined,
			clear = false,
			guild = true,
		}: {initEmoji?: undefined | Emoji; clear?: boolean; guild?: boolean} = {},
	) {
		this.label = label;
		this.owner = owner;
		this.guild = guild;
		this.onSubmit = onSubmit;
		this.value = initEmoji;
		this.localuser = localuser;
		this.clear = !!clear;
	}
	generateHTML(): HTMLElement {
		const outDiv = document.createElement("div");
		outDiv.classList.add("flexltr");
		const div = document.createElement("div");
		div.classList.add("flexltr", "emojiForm");
		const label = document.createElement("span");
		label.textContent = this.label;

		let emoji: HTMLElement;
		if (this.value) {
			emoji = this.value.getHTML();
		} else {
			emoji = document.createElement("span");
			emoji.classList.add("emptyEmoji");
		}
		div.onclick = (e) => {
			e.preventDefault();
			e.stopImmediatePropagation();
			(async () => {
				const emj = await this.localuser.emojiPicker(e.x, e.y, this.guild);
				if (emj) {
					this.value = emj;
					emoji.remove();
					emoji = emj.getHTML();
					div.append(emoji);
					this.onchange(emj);
					this.owner.changed();
				}
			})();
		};
		div.append(label, emoji);
		outDiv.append(div);
		if (this.clear) {
			const button = document.createElement("button");
			button.textContent = I18n.settings.clear();
			button.onclick = () => {
				this.value = null;
				emoji.remove();
				this.onchange(null);
				this.owner.changed();
				emoji = document.createElement("span");
				emoji.classList.add("emptyEmoji");
				div.append(emoji);
			};
			outDiv.append(button);
		}

		return outDiv;
	}
	onchange = (_: Emoji | undefined | null) => {};
	watchForChange(func: (arg1: Emoji | undefined | null) => void) {
		this.onchange = func;
	}
	submit() {
		this.onSubmit(this.value);
	}
}

class FileInput implements OptionsElement<FileList | null | undefined> {
	readonly label: string;
	readonly owner: Options;
	readonly onSubmit: (str: FileList | null) => void;
	input!: WeakRef<HTMLInputElement>;
	value: FileList | null | undefined = undefined;
	clear: boolean;
	constructor(
		label: string,
		onSubmit: (str: FileList | null) => void,
		owner: Options,
		{clear = false} = {},
	) {
		this.label = label;
		this.owner = owner;
		this.onSubmit = onSubmit;
		this.clear = clear;
	}
	generateHTML(): HTMLDivElement {
		const div = document.createElement("div");
		const span = document.createElement("span");
		span.textContent = this.label;
		div.append(span);
		const innerDiv = document.createElement("div");
		innerDiv.classList.add("flexltr", "fileinputdiv");
		const input = document.createElement("input");
		input.type = "file";
		input.oninput = this.onChange.bind(this);
		this.input = new WeakRef(input);
		innerDiv.append(input);
		if (this.clear) {
			const button = document.createElement("button");
			button.textContent = I18n.settings.clear();
			button.onclick = (_) => {
				if (this.onchange) {
					this.onchange(null);
				}
				this.value = null;
				this.owner.changed();
			};
			innerDiv.append(button);
		}
		div.append(innerDiv);
		return div;
	}
	onChange() {
		this.owner.changed();
		const input = this.input.deref();
		if (input) {
			this.value = input.files;
			if (this.onchange) {
				this.onchange(input.files);
			}
		}
	}
	onchange: ((str: FileList | null | undefined) => void) | null = null;
	watchForChange(func: (str: FileList | null | undefined) => void) {
		this.onchange = func;
	}
	submit() {
		const input = this.input.deref();
		if (input) {
			this.onSubmit(input.files);
		}
	}
}
class ImageInput extends FileInput {
	img: HTMLElement;
	constructor(
		label: string,
		onSubmit: (str: FileList | null) => void,
		owner: Options,
		{clear = false, initImg = "", width = -1, objectFit = ""} = {},
	) {
		super(label, onSubmit, owner, {clear});

		console.log(initImg);
		let hasimg = "" !== initImg;
		const input = document.createElement("input");
		input.type = "file";
		input.oninput = this.onChange.bind(this);
		this.input = new WeakRef(input);
		input.accept = "image/*";
		const img = document.createElement("img");
		img.src = initImg;

		const button = document.createElement("button");
		button.textContent = I18n.settings.clear();
		button.onclick = (_) => {
			img.src = "";
			if (this.onchange) {
				this.onchange(null);
			}
			this.value = null;
			this.owner.changed();
			hasimg = false;
			genImg();
		};
		this.clearbutton = button;

		input.addEventListener("change", () => {
			if (!input.files) return;
			const reader = new FileReader();
			reader.onload = (imgf) => {
				const res = imgf.target?.result;
				if (!res) return;
				if (typeof res !== "string") return;
				img.src = res;
				hasimg = true;
				genImg();
			};
			reader.readAsDataURL(input.files[0]);
		});
		const div = document.createElement("div");
		const span = document.createElement("span");
		span.textContent = I18n.settings.img();
		const genImg = () => {
			console.warn(hasimg);
			if (hasimg) {
				div.append(img);
				span.remove();
			} else {
				div.append(span);
				img.remove();
			}
		};
		if (width !== -1) {
			div.style.width = width + "px";
			img.style.width = width + "px";
		}
		if (objectFit) img.style.objectFit = objectFit;
		console.warn(objectFit);
		this.img = div;
		div.onclick = () => {
			input.click();
		};
		genImg();
	}
	clearbutton: HTMLButtonElement;
	generateHTML(): HTMLDivElement {
		const div = document.createElement("div");
		const span = document.createElement("span");
		span.textContent = this.label;
		div.append(span);
		const innerDiv = document.createElement("div");
		innerDiv.classList.add("flexltr", "fileinputdiv");
		innerDiv.append(this.img);

		if (this.clear) {
			innerDiv.append(this.clearbutton);
		}
		div.append(innerDiv);
		return div;
	}
}

class HtmlArea implements OptionsElement<void> {
	submit: () => void;
	html: (() => HTMLElement) | HTMLElement;
	value!: void;
	constructor(html: (() => HTMLElement) | HTMLElement, submit: () => void) {
		this.submit = submit;
		this.html = html;
	}
	generateHTML(): HTMLElement {
		if (this.html instanceof Function) {
			return (this.html = this.html());
		} else {
			return this.html;
		}
	}
	watchForChange() {}
}
/**
 * This is a simple wrapper class for Options to make it happy so it can be used outside of Settings.
 */
class Float {
	options: Options;
	html: WeakRef<HTMLElement> = new WeakRef(document.createElement("div"));
	/**
	 * This is a simple wrapper class for Options to make it happy so it can be used outside of Settings.
	 */
	constructor(name: string, options = {ltr: false, noSubmit: true}) {
		this.options = new Options(name, this, options);
	}
	changed(d: HTMLElement) {
		const html = this.html.deref();
		if (!html) return;
		html.append(d);
	}
	generateHTML() {
		const html = this.options.generateHTML();
		this.html = new WeakRef(html);
		return html;
	}
}
class Dialog {
	float: Float;
	above = false;
	get options() {
		return this.float.options;
	}
	background = new WeakRef(document.createElement("div"));
	constructor(name: string, {ltr = false, noSubmit = true, goAbove = false} = {}) {
		this.float = new Float(name, {ltr, noSubmit});
		this.above = goAbove;
	}
	onhide = () => {};
	show(hideOnClick = true) {
		const background = document.createElement("div");
		background.classList.add("background");
		if (this.above) background.style.zIndex = "200";
		if (!hideOnClick) background.classList.add("solidBackground");
		const center = this.float.generateHTML();
		center.classList.add("centeritem", "nonimagecenter", "dialogModal");
		center.classList.remove("titlediv");
		background.append(center);
		document.body.append(background);
		this.background = new WeakRef(background);
		background.onclick = (_) => {
			if (hideOnClick && _.target === background) {
				removeAni(background);
				this.onhide();
			}
		};
		background.tabIndex = 0;
		background.focus();
		background.onkeydown = (e) => {
			if (e.key === "Escape" && hideOnClick) {
				removeAni(background);
				this.onhide();
			}
		};
		return center;
	}
	hide() {
		const background = this.background.deref();
		if (!background) return;
		removeAni(background);
	}
}
class InstancePicker implements OptionsElement<InstanceInfo | null> {
	value: InstanceInfo | null = null;
	owner: Options | Form;
	verify = document.createElement("p");
	onchange = (_: InstanceInfo) => {};
	instance?: string;
	validation = 0;
	watchForChange(func: (arg1: InstanceInfo) => void) {
		this.onchange = func;
	}
	constructor(
		owner: Options | Form,
		onchange?: InstancePicker["onchange"],
		button?: HTMLButtonElement,
		instance?: string,
	) {
		this.owner = owner;
		this.instance = instance;
		if (onchange) {
			this.onchange = onchange;
		}
		this.button = button;
	}
	generateHTML(): HTMLElement {
		const div = document.createElement("div");
		const span = document.createElement("span");
		span.textContent = I18n.htmlPages.instanceField();
		div.append(span);

		const verify = this.verify;
		verify.classList.add("verify");
		div.append(verify);
		this.div = div;

		const input = this.input;
		const queryInstance = new URLSearchParams(window.location.search).get("instance");
		input.value = this.instance || queryInstance || getDefaultInstanceUrl() || "";
		// The browser's own search-history autofill duplicates the list with every pasted
		// origin variant; the rows below are the only suggestions.
		input.autocomplete = "off";
		input.readOnly = !!queryInstance;
		input.type = "search";
		input.setAttribute("list", "instances");
		div.append(input);
		const suggest = document.createElement("div");
		suggest.classList.add("instancesuggest");
		div.append(suggest);
		let cur = 0;
		input.onkeyup = async () => {
			// A key that edits nothing (Tab, arrows, the submitting Enter) leaves the check alone.
			if (input.value === this.checkedValue) return;
			// The edit voids the last check NOW: through the debounce an Enter would otherwise
			// submit on the previous value's "ok" (and a check still in flight must not land).
			this.checkedValue = undefined;
			++this.validation;
			this.validationState = "pending";
			if (this.button) this.button.disabled = true;
			const thiscur = ++cur;
			await new Promise((res) => setTimeout(res, 500));
			if (thiscur === cur) {
				this.validate();
			}
		};

		InstancePicker.picker = this;
		InstancePicker.genDataList();

		return div;
	}
	button?: HTMLButtonElement;
	input = document.createElement("input");
	div?: HTMLElement;
	/** Whether the CURRENT input value has passed an instance check. Submission is gated on
	 * this: an unvalidated origin used to log straight into a dead endpoint and hang. */
	validationState: "pending" | "invalid" | "ok" = "pending";
	/** The input value the latest check ran on (undefined once an edit voids it). */
	checkedValue?: string;
	async validate() {
		this.checkedValue = this.input.value;
		const validation = ++this.validation;
		const isLatest = () => validation === this.validation;
		if (this.button) this.button.disabled = true;
		this.validationState = "pending";
		this.verify.textContent = I18n.login.checking();
		const urls = await checkInstance(this.input.value);
		// Checks can finish out of order. Only the latest may update the button, be stored or be
		// applied, or a login could go to (or be saved against) an instance the user didn't pick.
		if (!isLatest()) return;
		if (!urls) {
			this.validationState = "invalid";
			// From a loopback page (localhost:8080 on the Deck), a non-local origin's
			// certificate can never match — the failure is silent in JS, but the condition is
			// computable, and "invalid" alone sent the user round in circles.
			const pageLocal = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
			let targetLocal = false;
			if (URL.canParse(this.input.value)) {
				targetLocal = ["localhost", "127.0.0.1", "[::1]"].includes(
					new URL(this.input.value).hostname,
				);
			}
			this.verify.textContent =
				pageLocal && !targetLocal
					? I18n.login.certHint(this.input.value)
					: I18n.login.invalid();
			return;
		}
		this.validationState = "ok";
		this.verify.textContent = I18n.login.allGood();
		if (this.button) this.button.disabled = false;
		localStorage.setItem("instanceinfo", JSON.stringify(urls));
		this.onchange(urls);
		setTimeout(() => {
			if (isLatest()) this.verify.textContent = "";
		}, 3000);
	}
	giveButton(button: HTMLButtonElement | undefined) {
		this.button = button;
		if (this.input.value) {
			this.validate();
		} else if (button) {
			button.disabled = true;
		}
	}
	static picker?: InstancePicker;
	static genDataList() {
		let datalist = document.getElementById("instances");
		if (!datalist) {
			datalist = document.createElement("datalist");
			datalist.setAttribute("id", "instances");
			document.body.append(datalist);
		}

		const json = getInstances();

		if (!isInstanceListLoaded()) {
			instancefetch.then(this.genDataList.bind(this));
			return;
		}

		const getInstanceUrl = (instance: ReturnType<typeof getInstances>[number]) =>
			instance.url || instance.urls?.wellknown;
		const picker = this.picker;
		const value =
			picker?.instance ||
			new URLSearchParams(window.location.search).get("instance") ||
			getDefaultInstanceUrl();
		if (picker && value) {
			picker.input.value = value;
			if (picker.button) {
				picker.validate();
			}
		}

		const suggest = picker?.div?.querySelector(".instancesuggest");
		suggest?.replaceChildren();
		for (const instance of json) {
			if (instance.display === false) {
				continue;
			}
			const option = document.createElement("option");
			option.disabled = instance.online === false;
			const url = getInstanceUrl(instance);
			option.value = url || "";
			if (!url) option.disabled = true;
			if (instance.description) {
				option.label = instance.description;
			} else {
				option.label = instance.name;
			}
			// An offline instance is no pick (the default-instance choice skips it too).
			if (suggest && url && instance.online !== false) {
				// Native datalists are inconsistent (the arrow does nothing until the list is
				// loaded, and some platforms hide it entirely): render the same entries as
				// plain rows. mousedown, because click lands after the input loses focus.
				const row = document.createElement("div");
				row.textContent = instance.name + " — " + url;
				row.onmousedown = (e) => {
					e.preventDefault();
					// A ?instance= link locks the input; a row must not unlock it by the side.
					if (!picker || picker.input.readOnly) return;
					picker.input.value = url;
					picker.input.dispatchEvent(new KeyboardEvent("keyup"));
				};
				suggest.append(row);
			}
		}

		if (datalist.childElementCount !== 0) {
			return;
		}

		for (const instance of json) {
			if (instance.display === false) {
				continue;
			}
			const option = document.createElement("option");
			option.disabled = instance.online === false;
			const url = getInstanceUrl(instance);
			option.value = url || "";
			if (!url) option.disabled = true;
			if (instance.description) {
				option.label = instance.description;
			} else {
				option.label = instance.name;
			}
			datalist.append(option);
		}
	}
	submit() {}
}
setTimeout(InstancePicker.genDataList.bind(InstancePicker), 0);
export {Dialog};
class Options implements OptionsElement<void> {
	name: string;
	haschanged = false;
	private saveBar?: HTMLElement;
	options: OptionsElement<any>[];
	readonly owner: Buttons | Options | Form | Float;
	readonly ltr: boolean;
	value!: void;
	readonly html: WeakMap<OptionsElement<any>, WeakRef<HTMLDivElement>> = new WeakMap();
	readonly noSubmit: boolean = false;
	container: WeakRef<HTMLDivElement> = new WeakRef(document.createElement("div"));
	vsmaller = false;
	constructor(
		name: string,
		owner: Buttons | Options | Form | Float,
		{ltr = false, noSubmit = false, vsmaller = false} = {},
	) {
		this.name = name;
		this.options = [];
		this.owner = owner;
		this.ltr = ltr;
		this.noSubmit = noSubmit;
		this.vsmaller = vsmaller;
	}
	removeAll() {
		this.returnFromSub();
		while (this.options.length) {
			this.options.pop();
		}
		const container = this.container.deref();
		if (container) {
			container.innerHTML = "";
		}
	}
	watchForChange() {}
	addOptions(name: string, {ltr = false, noSubmit = false} = {}) {
		const options = new Options(name, this, {ltr, noSubmit});
		this.options.push(options);
		this.generate(options);
		return options;
	}
	addButtons(name: string, {top = false, titles = true} = {}) {
		const buttons = new Buttons(name, {top, titles});
		this.options.push(buttons);
		this.generate(buttons);
		return buttons;
	}
	subOptions: Options | Form | undefined;
	genTop() {
		const container = this.container.deref();
		if (container) {
			if (this.isTop()) {
				this.generateContainer();
			} else if (this.owner instanceof Options) {
				this.owner.genTop();
			} else {
				(this.owner as Form).owner.genTop();
			}
		} else {
			throw new Error("Tried to make a sub menu when the options weren't rendered");
		}
	}
	addSubOptions(name: string, {ltr = false, noSubmit = false} = {}) {
		const options = new Options(name, this, {ltr, noSubmit});
		this.subOptions = options;
		this.genTop();
		return options;
	}
	addSubForm(
		name: string,
		onSubmit: (arg1: object, sent: object) => void,
		{
			ltr = false,
			submitText = "Submit",
			fetchURL = "",
			headers = {},
			method = "POST",
			traditionalSubmit = false,
			tfaCheck = true,
		} = {},
	) {
		const options = new Form(name, this, onSubmit, {
			ltr,
			submitText,
			fetchURL,
			headers,
			method,
			traditionalSubmit,
			tfaCheck,
		});
		this.subOptions = options;
		this.genTop();
		return options;
	}
	addEmojiInput(
		label: string,
		onSubmit: (str: Emoji | null | undefined) => void,
		localuser: Localuser,
		{initEmoji = undefined, clear = false, guild = true} = {} as {
			initEmoji?: Emoji;
			clear?: boolean;
			guild?: boolean;
		},
	) {
		const emoji = new EmojiInput(label, onSubmit, this, localuser, {
			initEmoji: initEmoji,
			clear,
			guild,
		});
		this.options.push(emoji);
		this.generate(emoji);
		return emoji;
	}
	addInstancePicker(
		onchange?: InstancePicker["onchange"],
		{button, instance}: {button?: HTMLButtonElement; instance?: string} = {},
	) {
		const instancePicker = new InstancePicker(this, onchange, button, instance);
		this.options.push(instancePicker);
		this.generate(instancePicker);
		return instancePicker;
	}
	returnFromSub() {
		this.subOptions = undefined;
		this.genTop();
	}
	addSelect(
		label: string,
		onSubmit: (str: number) => void,
		selections: readonly string[],
		{defaultIndex = 0, radio = false} = {},
	) {
		const select = new SelectInput(label, onSubmit, selections, this, {
			defaultIndex,
			radio,
		});
		this.options.push(select);
		this.generate(select);
		return select;
	}
	addAsyncMultiSelect(
		label: string,
		onSubmit: (str: string[]) => void,
		selections: AsyncMultiSelect["searchFunc"],
		{defaultValues = [] as searchRes[]} = {},
	) {
		const select = new AsyncMultiSelect(label, onSubmit, selections, this, {
			defaultValues,
		});
		this.options.push(select);
		this.generate(select);
		return select;
	}
	addImageInput(
		label: string,
		onSubmit: (files: FileList | null) => void,
		{clear = false, initImg = "", width = -1, objectFit = ""} = {},
	) {
		const FI = new ImageInput(label, onSubmit, this, {clear, initImg, width, objectFit});
		this.options.push(FI);
		this.generate(FI);
		return FI;
	}
	addFileInput(label: string, onSubmit: (files: FileList | null) => void, {clear = false} = {}) {
		const FI = new FileInput(label, onSubmit, this, {clear});
		this.options.push(FI);
		this.generate(FI);
		return FI;
	}
	addDateInput(
		label: string,
		onSubmit: (str: string | undefined) => void,
		{initText = "" as string | Date} = {},
	) {
		const textInput = new DateInput(label, onSubmit, this, {
			initText,
		});
		this.options.push(textInput);
		this.generate(textInput);
		return textInput;
	}
	addTextInput(
		label: string,
		onSubmit: (str: string) => void,
		{initText = "", password = false, spaceReplace = " "} = {},
	) {
		const textInput = new TextInput(label, onSubmit, this, {
			initText,
			password,
			spaceReplace,
		});
		this.options.push(textInput);
		this.generate(textInput);
		return textInput;
	}
	addColorInput(label: string, onSubmit: (str: string) => void, {initColor = ""} = {}) {
		const colorInput = new ColorInput(label, onSubmit, this, {initColor});
		this.options.push(colorInput);
		this.generate(colorInput);
		return colorInput;
	}
	addMDInput(label: string, onSubmit: (str: string) => void, {initText = ""} = {}) {
		const mdInput = new MDInput(label, onSubmit, this, {initText});
		this.options.push(mdInput);
		this.generate(mdInput);
		return mdInput;
	}
	addHTMLArea(html: (() => HTMLElement) | HTMLElement, submit: () => void = () => {}) {
		const htmlarea = new HtmlArea(html, submit);
		this.options.push(htmlarea);
		this.generate(htmlarea);
		return htmlarea;
	}
	addButtonInput(label: string, textContent: string, onSubmit: () => void) {
		const button = new ButtonInput(label, textContent, onSubmit, this);
		this.options.push(button);
		this.generate(button);
		return button;
	}
	addCheckboxInput(label: string, onSubmit: (str: boolean) => void, {initState = false} = {}) {
		const box = new CheckboxInput(label, onSubmit, this, {initState});
		this.options.push(box);
		this.generate(box);
		return box;
	}
	addText(str: string) {
		const text = new SettingsText(str);
		this.options.push(text);
		this.generate(text);
		return text;
	}
	addMDText(str: MarkDown) {
		const text = new SettingsMDText(str);
		this.options.push(text);
		this.generate(text);
		return text;
	}
	addHR() {
		const rule = new HorizontalRule();
		this.options.push(rule);
		this.generate(rule);
		return rule;
	}
	addTitle(str: string) {
		const text = new SettingsTitle(str);
		this.options.push(text);
		this.generate(text);
		return text;
	}
	addForm(
		name: string,
		onSubmit: (arg1: object, sent: object) => void,
		{
			ltr = false,
			submitText = I18n.submit(),
			fetchURL = "",
			headers = {},
			method = "POST",
			traditionalSubmit = false,
			vsmaller = false,
		} = {},
	) {
		const options = new Form(name, this, onSubmit, {
			ltr,
			submitText,
			fetchURL,
			headers,
			method,
			traditionalSubmit,
			vsmaller,
		});
		this.options.push(options);
		this.generate(options);
		return options;
	}
	generate(elm: OptionsElement<any>) {
		const container = this.container.deref();
		if (container) {
			const div = document.createElement("div");
			if (!(elm instanceof Options)) {
				div.classList.add("optionElement");
			}
			const html = elm.generateHTML();
			div.append(html);
			this.html.set(elm, new WeakRef(div));
			container.append(div);
		}
	}
	deleteElm(opt: OptionsElement<any>) {
		const html = this.html.get(opt)?.deref();
		this.options = this.options.filter((_) => _ !== opt);
		if (!html) return;
		html.remove();
		this.html.delete(opt);
	}
	title: WeakRef<HTMLElement> = new WeakRef(document.createElement("h2"));
	headerActions: HTMLElement[] = [];
	generateHTML(): HTMLElement {
		const div = document.createElement("div");
		div.classList.add("flexttb", "titlediv");
		if (this.vsmaller) div.classList.add("vsmaller");
		if (this.owner instanceof Options) {
			div.classList.add("optionElement");
		}
		const title = document.createElement("h2");
		title.textContent = this.name;
		if (this.name !== "") {
			title.classList.add("settingstitle");
			if (this.headerActions.length) {
				const headerRow = document.createElement("div");
				headerRow.classList.add("settingsHeaderRow");
				title.classList.add("settingsHeaderTitle");
				headerRow.append(title);
				const actions = document.createElement("div");
				actions.classList.add("settingsHeaderActions");
				actions.append(...this.headerActions);
				headerRow.append(actions);
				div.append(headerRow);
			} else {
				div.append(title);
			}
		} else {
			div.append(title);
		}
		this.title = new WeakRef(title);
		const container = document.createElement("div");
		this.container = new WeakRef(container);
		container.classList.add(this.ltr ? "flexltr" : "flexttb", "flexspace");
		this.generateContainer();
		div.append(container);
		return div;
	}

	generateName(): (HTMLElement | string)[] {
		const build: (HTMLElement | string)[] = [];
		if (this.subOptions) {
			if (this.name !== "") {
				const name = document.createElement("span");
				name.innerText = this.name;
				name.classList.add("clickable");
				name.onclick = () => {
					this.returnFromSub();
				};
				build.push(name);
				build.push(" > ");
			}
			if (this.subOptions instanceof Options) {
				build.push(...this.subOptions.generateName());
			} else {
				build.push(...this.subOptions.options.generateName());
			}
		} else {
			const name = document.createElement("span");
			name.innerText = this.name;
			build.push(name);
		}
		return build;
	}
	isTop() {
		return (
			(this.owner instanceof Options && this.owner.subOptions !== this) ||
			(this.owner instanceof Form && this.owner.owner.subOptions !== this.owner) ||
			this.owner instanceof Settings ||
			this.owner instanceof Buttons ||
			this.owner instanceof Float
		);
	}
	generateContainer() {
		const container = this.container.deref();
		if (container) {
			container.innerHTML = "";
			const title = this.title.deref();
			if (title) title.innerHTML = "";

			console.log(container.children);
			if (this.isTop()) {
				if (title) {
					const elms = this.generateName();
					title.append(...elms);
				}
			}
			if (!this.subOptions) {
				for (const thing of this.options) {
					this.generate(thing);
				}
			} else {
				container.append(this.subOptions.generateHTML());
			}
			if (title && title.innerText !== "") {
				title.classList.add("settingstitle");
			} else if (title) {
				title.classList.remove("settingstitle");
			}
			if (this.owner instanceof Form && this.owner.button) {
				const button = this.owner.button.deref();
				if (button) {
					button.hidden = false;
				}
			}
		} else {
			console.warn("tried to generate container, but it did not exist");
		}
	}
	changed() {
		if (this.noSubmit) {
			return;
		}
		if (this.owner instanceof Options || this.owner instanceof Form) {
			this.owner.changed();
			return;
		}
		// Switching tabs removes the bar without saving; the next edit shows it again.
		if (!this.haschanged || !this.saveBar?.isConnected) {
			const div = document.createElement("div");
			this.saveBar = div;
			div.classList.add("flexltr", "savediv");
			const span = document.createElement("span");
			div.append(span);
			span.textContent = I18n.settings.unsaved();
			const button = document.createElement("button");
			button.textContent = I18n.settings.save();
			div.append(button);
			this.haschanged = true;
			this.owner.changed(div);

			button.onclick = (_) => {
				if (this.owner instanceof Buttons) {
					this.owner.save();
				}
				div.remove();
				this.submit();
			};
		}
	}
	afterSubmit = () => {};
	submit() {
		this.haschanged = false;
		if (this.subOptions) {
			this.subOptions.submit();
			return;
		}

		for (const thing of this.options) {
			thing.submit();
		}
		this.afterSubmit();
	}
}
class Captcha implements OptionsElement<string> {
	owner: Form;
	value: string = "";
	constructor(owner: Form) {
		this.owner = owner;
	}
	div?: HTMLElement;
	generateHTML(): HTMLElement {
		const div = document.createElement("div");
		this.div = div;
		return div;
	}
	submit() {}
	onchange = (_: string) => {};
	watchForChange(func: (arg1: string) => void) {
		this.onchange = func;
	}
	static hcaptcha?: HTMLDivElement;
	static async waitForCaptcha(ctype: "hcaptcha") {
		switch (ctype) {
			case "hcaptcha":
				if (!this.hcaptcha) throw Error("no captcha found");
				const hcaptcha = this.hcaptcha;
				console.log(hcaptcha);
				//@ts-expect-error
				while (!hcaptcha.children[1].children.length || !hcaptcha.children[1].children[1].value) {
					await new Promise<void>((res) => setTimeout(res, 100));
				}
				//@ts-expect-error
				return hcaptcha.children[1].children[1].value;
		}
	}
	async makeCaptcha({
		captcha_sitekey,
		captcha_service,
	}: {
		captcha_sitekey: string;
		captcha_service: "hcaptcha";
	}): Promise<string> {
		if (!this.div) throw new Error("Div doesn't exist yet to give catpcha");
		switch (captcha_service) {
			case "hcaptcha":
				if (Captcha.hcaptcha) {
					this.div.append(Captcha.hcaptcha);
					Captcha.hcaptcha.setAttribute("data-sitekey", captcha_sitekey);
					const hc = (globalThis as typeof globalThis & {hcaptcha?: {reset?: () => void}}).hcaptcha;
					hc?.reset?.();
					return Captcha.waitForCaptcha(captcha_service);
				} else {
					const capt = document.createElement("div");
					const capty = document.createElement("div");
					capty.classList.add("h-captcha");

					capty.setAttribute("data-sitekey", captcha_sitekey);
					const script = document.createElement("script");
					script.src = "https://js.hcaptcha.com/1/api.js";
					capt.append(script);
					capt.append(capty);
					Captcha.hcaptcha = capt;
					this.div.append(capt);
					return Captcha.waitForCaptcha(captcha_service);
				}
		}
	}
	static async makeCaptcha(json: {
		captcha_sitekey: string;
		captcha_service: "hcaptcha";
	}): Promise<string> {
		const float = new Dialog("", {noSubmit: true});
		float.options.addTitle(I18n.form.captcha());
		const cap = float.options.addForm("", () => {}, {traditionalSubmit: true}).addCaptcha();
		float.show().parentElement!.style.zIndex = "200";
		const ret = cap.makeCaptcha(json);
		await ret;
		float.hide();
		return ret;
	}
}
class FormError extends Error {
	elem: OptionsElement<any>;
	message: string;
	constructor(elem: OptionsElement<any>, message: string) {
		super(message);
		this.message = message;
		this.elem = elem;
	}
}
async function handle2fa(json: any, api: string): Promise<false | any> {
	if (json.ticket) {
		if (json.webauthn) {
			const challenge = JSON.parse(json.webauthn)
				.publicKey as PublicKeyCredentialRequestOptionsJSON;
			challenge.challenge = challenge.challenge
				.split("=")[0]
				.replaceAll("+", "-")
				.replaceAll("/", "_");
			challenge.allowCredentials?.forEach(
				(_) => (_.id = _.id.split("=")[0].replaceAll("+", "-").replaceAll("/", "_")),
			);
			console.log(challenge);
			const options = PublicKeyCredential.parseRequestOptionsFromJSON(challenge);
			const credential = (await navigator.credentials.get({publicKey: options})) as unknown as {
				rawId: ArrayBuffer;
				response: {
					[key: string]: ArrayBuffer;
				};
			};
			if (!credential) return false;
			function toBase64(buf: ArrayBuffer) {
				return btoa(String.fromCharCode(...new Uint8Array(buf)));
			}
			const keys = ["authenticatorData", "clientDataJSON", "signature"];
			const response = {} as any;
			for (const key of keys) {
				response[key] = toBase64(credential.response[key] as ArrayBuffer);
			}
			const res = {
				rawId: toBase64(credential.rawId),
				response,
			};
			const resObj = await fetch(api + "/auth/mfa/webauthn", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({code: JSON.stringify(res), ticket: json.ticket}),
			});
			if (!resObj.ok) return false;
			const jsonRes = await resObj.json();
			return jsonRes;
		} else {
			return new Promise<boolean>((resolution) => {
				const better = new Dialog("");
				const form = better.options.addForm(
					"",
					(res: any) => {
						resolution(res);
						better.hide();
					},
					{
						fetchURL: api + "/auth/mfa/totp",
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
					},
				);
				form.addTitle(I18n["2faCode"]());
				form.addPreprocessor((e) => {
					//@ts-ignore
					e.ticket = json.ticket;
				});
				const ti = form.addTextInput("", "code");
				form.onErrorBody = (res) => {
					if (typeof res.message === "string") throw new FormError(ti, res.message);
				};
				better.show().parentElement!.style.zIndex = "200";
			});
		}
	} else {
		return false;
	}
}
async function handleCaptcha(json: any, build: any, cap: Captcha | undefined) {
	if (json.captcha_sitekey) {
		let token: string;
		if (cap) {
			token = await cap.makeCaptcha(json);
		} else {
			token = await Captcha.makeCaptcha(json);
		}
		build.captcha_key = token;
		return true;
	}
	return false;
}
export {FormError};
class Form implements OptionsElement<object> {
	name: string;
	readonly options: Options;
	readonly owner: Options;
	readonly ltr: boolean;
	readonly names: Map<string, OptionsElement<any>> = new Map();
	readonly required: WeakSet<OptionsElement<any>> = new WeakSet();
	readonly submitText: string;
	fetchURL: string;
	readonly headers = {};
	readonly method: string;
	value!: object;
	traditionalSubmit: boolean;
	values: {[key: string]: any} = {};
	tfaCheck: boolean;
	constructor(
		name: string,
		owner: Options,
		onSubmit: (arg1: object, sent: object) => void,
		{
			ltr = false,
			submitText = I18n.submit(),
			fetchURL = "",
			headers = {},
			method = "POST",
			traditionalSubmit = false,
			vsmaller = false,
			tfaCheck = true,
		} = {},
	) {
		this.traditionalSubmit = traditionalSubmit;
		this.name = name;
		this.tfaCheck = tfaCheck;
		this.method = method;
		this.submitText = submitText;
		this.options = new Options(name, this, {ltr, vsmaller});
		this.owner = owner;
		this.fetchURL = fetchURL;
		this.headers = headers;
		this.ltr = ltr;
		this.onSubmit = onSubmit;
	}
	setValue(key: string, value: any) {
		//the value can't really be anything, but I don't care enough to fix this
		this.values[key] = value;
	}
	addSubOptions(name: string, {ltr = false, noSubmit = false} = {}) {
		if (this.button && this.button.deref()) {
			(this.button.deref() as HTMLElement).hidden = true;
		}
		return this.options.addSubOptions(name, {ltr, noSubmit});
	}
	addHTMLArea(html: (() => HTMLElement) | HTMLElement, onSubmit = () => {}) {
		return this.options.addHTMLArea(html, onSubmit);
	}
	private captcha?: Captcha;
	addCaptcha() {
		if (this.captcha) throw new Error("only one captcha is allowed per form");
		const cap = new Captcha(this);
		this.options.options.push(cap);
		this.options.generate(cap);
		this.captcha = cap;
		return cap;
	}
	addSubForm(
		name: string,
		onSubmit: (arg1: object, sent: object) => void,
		{
			ltr = false,
			submitText = I18n.submit(),
			fetchURL = "",
			headers = {},
			method = "POST",
			traditionalSubmit = false,
		} = {},
	) {
		if (this.button && this.button.deref()) {
			console.warn("hidden");
			(this.button.deref() as HTMLElement).hidden = true;
		}
		return this.options.addSubForm(name, onSubmit, {
			ltr,
			submitText,
			fetchURL,
			headers,
			method,
			traditionalSubmit,
		});
	}
	generateContainer() {
		this.options.generateContainer();
		if (this.options.isTop() && this.button && this.button.deref()) {
			(this.button.deref() as HTMLElement).hidden = false;
		}
	}
	selectMap = new WeakMap<SelectInput, readonly (number | string | null | undefined)[]>();
	addSelect(
		label: string,
		formName: string,
		selections: string[],
		{defaultIndex = 0, required = false, radio = false} = {},
		correct: readonly (string | number | null | undefined)[] = selections,
	) {
		const select = this.options.addSelect(label, (_) => {}, selections, {
			defaultIndex,
			radio,
		});
		this.selectMap.set(select, correct);
		this.names.set(formName, select);
		if (required) {
			this.required.add(select);
		}
		return select;
	}
	readonly fileOptions: Map<FileInput, {files: "one" | "multi"}> = new Map();
	addFileInput(
		label: string,
		formName: string,
		{required = false, files = "one", clear = false} = {},
	) {
		const FI = this.options.addFileInput(label, (_) => {}, {clear});
		if (files !== "one" && files !== "multi") throw new Error("files should equal one or multi");
		this.fileOptions.set(FI, {files});
		this.names.set(formName, FI);
		if (required) {
			this.required.add(FI);
		}
		return FI;
	}
	addImageInput(
		label: string,
		formName: string,
		{required = false, files = "one", clear = false, initImg = "", width = -1, objectFit = ""} = {},
	) {
		const FI = this.options.addImageInput(label, (_) => {}, {clear, initImg, width, objectFit});
		if (files !== "one" && files !== "multi") throw new Error("files should equal one or multi");
		this.fileOptions.set(FI, {files});
		this.names.set(formName, FI);
		if (required) {
			this.required.add(FI);
		}
		return FI;
	}
	addEmojiInput(
		label: string,
		formName: string,
		localuser: Localuser,
		{initEmoji = undefined, required = false, clear = false, guild = true} = {} as {
			initEmoji?: Emoji;
			required: boolean;
			clear?: boolean;
			guild?: boolean;
		},
	) {
		const emoji = this.options.addEmojiInput(label, () => {}, localuser, {
			initEmoji: initEmoji,
			clear,
			guild,
		});
		if (required) {
			this.required.add(emoji);
		}
		this.names.set(formName, emoji);
		return emoji;
	}
	addDateInput(label: string, formName: string, {initText = "", required = false} = {}) {
		const dateInput = this.options.addDateInput(label, (_) => {}, {
			initText,
		});
		this.names.set(formName, dateInput);
		if (required) {
			this.required.add(dateInput);
		}
		return dateInput;
	}
	addTextInput(
		label: string,
		formName: string,
		{initText = "", required = false, password = false, spaceReplace = " "} = {},
	) {
		const textInput = this.options.addTextInput(label, (_) => {}, {
			initText,
			password,
			spaceReplace,
		});
		this.names.set(formName, textInput);
		if (required) {
			this.required.add(textInput);
		}
		return textInput;
	}
	addColorInput(label: string, formName: string, {initColor = "", required = false} = {}) {
		const colorInput = this.options.addColorInput(label, (_) => {}, {
			initColor,
		});
		this.names.set(formName, colorInput);
		if (required) {
			this.required.add(colorInput);
		}
		return colorInput;
	}

	addMDInput(label: string, formName: string, {initText = "", required = false} = {}) {
		const mdInput = this.options.addMDInput(label, (_) => {}, {initText});
		this.names.set(formName, mdInput);
		if (required) {
			this.required.add(mdInput);
		}
		return mdInput;
	}
	/**
	 * This function does not integrate with the form, so be aware of that
	 *
	 */
	addButtonInput(label: string, textContent: string, onSubmit: () => void) {
		return this.options.addButtonInput(label, textContent, onSubmit);
	}
	/**
	 * This function does not integrate with the form, so be aware of that
	 *
	 */
	addOptions(name: string, {ltr = false, noSubmit = false} = {}) {
		return this.options.addOptions(name, {ltr, noSubmit});
	}
	addCheckboxInput(label: string, formName: string, {initState = false, required = false} = {}) {
		const box = this.options.addCheckboxInput(label, (_) => {}, {initState});
		this.names.set(formName, box);
		if (required) {
			this.required.add(box);
		}
		return box;
	}
	addText(str: string) {
		return this.options.addText(str);
	}
	addMDText(str: MarkDown) {
		return this.options.addMDText(str);
	}
	addHR() {
		return this.options.addHR();
	}
	addTitle(str: string) {
		this.options.addTitle(str);
	}
	handleError(error: FormError) {
		this.onFormError(error);
		const elm = this.options.html.get(error.elem);
		if (elm) {
			const html = elm.deref();
			if (html) {
				this.makeError(html, error.message);
			}
		}
	}
	button!: WeakRef<HTMLButtonElement>;
	generateHTML(): HTMLElement {
		const div = document.createElement("div");
		div.append(this.options.generateHTML());
		div.classList.add("FormSettings");
		if (!this.traditionalSubmit && this.submitText) {
			const button = document.createElement("button");
			button.onclick = async (_) => {
				await this.submit();
			};
			button.textContent = this.submitText;
			div.append(button);
			if (this.options.subOptions) {
				button.hidden = true;
			}
			this.button = new WeakRef(button);
		}
		return div;
	}
	onSubmit:
		| ((arg1: object, sent: object) => void)
		| ((arg1: object, sent: object) => Promise<void>);
	watchForChange(func: (arg1: object) => void) {
		this.onSubmit = func;
	}
	changed() {
		if (this.traditionalSubmit) {
			this.owner.changed();
		}
	}
	preprocessor: (obj: Object) => void = () => {};
	addPreprocessor(func: (obj: Object) => void) {
		this.preprocessor = func;
	}
	onFormError = (_: FormError) => {};
	/** Answers an error response (non-2xx) instead of onSubmit: throw a FormError to show it on a
	 * field, or return true once handled; otherwise the server's message shows in a popup. */
	onErrorBody?: (body: any, status: number) => boolean | void;
	subbmitting = false;
	/** URLs with a request still unanswered: a second tap waits, but a form re-pointed at
	 * another URL (login after picking another instance) may send there. */
	private readonly inFlight = new Set<string>();
	async submit() {
		if (this.options.subOptions) {
			this.options.subOptions.submit();
			return;
		}
		if (this.subbmitting || this.inFlight.has(this.fetchURL)) return;
		this.subbmitting = true;
		try {
			console.log("start");
			const build = {};
			for (const key of Object.keys(this.values)) {
				const thing = this.values[key];
				if (thing instanceof Function) {
					try {
						(build as any)[key] = thing();
					} catch (e: any) {
						if (e instanceof FormError) {
							this.handleError(e);
						}
						return;
					}
				} else {
					(build as any)[key] = thing;
				}
			}
			console.log("middle");
			const promises: Promise<void>[] = [];
			for (const thing of this.names.keys()) {
				if (thing === "") continue;
				const input = this.names.get(thing) as OptionsElement<any>;
				if (input instanceof SelectInput) {
					(build as any)[thing] = (this.selectMap.get(input) as string[])[input.value];
					continue;
				} else if (input instanceof FileInput) {
					const options = this.fileOptions.get(input);
					if (!options) {
						throw new Error(
							"FileInput without its options is in this form, this should never happen.",
						);
					}
					if (options.files === "one") {
						console.log(input.value);
						if (input.value) {
							const reader = new FileReader();
							const promise = new Promise<void>((res) => {
								reader.onload = () => {
									(build as any)[thing] = reader.result;
									res();
								};
							});
							reader.readAsDataURL(input.value[0]);
							promises.push(promise);
							continue;
						}
					} else {
						console.error(options.files + " is not currently implemented");
					}
				} else if (input instanceof EmojiInput) {
					if (!input.value) {
						(build as any)[thing] = input.value;
					} else if (input.value.id) {
						(build as any)[thing] = input.value.id;
					} else if (input.value.emoji) {
						(build as any)[thing] = input.value.emoji;
					}
					continue;
				}
				(build as any)[thing] = input.value;
			}
			console.log("middle2");
			await Promise.allSettled(promises);
			try {
				this.preprocessor(build);
			} catch (e) {
				if (e instanceof FormError) {
					this.handleError(e);
				}
				return;
			}
			if (this.fetchURL !== "") {
				// Captcha and 2FA retries go to the URL this submit started with, even if the
				// form is pointed elsewhere meanwhile (login pages re-point it on instance change).
				const fetchURL = this.fetchURL;
				const onSubmit = async (json: any) => {
					try {
						await this.onSubmit(json, build);
					} catch (e) {
						console.error(e);
						if (e instanceof FormError) {
							this.handleError(e);
						}
						return;
					}
				};
				const doFetch = async (): Promise<void> => {
					let json: any;
					let status: number;
					// A second tap waits for the answer; the captcha and 2FA prompts after it don't
					// hold the guard, so closing one leaves the form sendable.
					this.inFlight.add(fetchURL);
					try {
						const res = await fetch(fetchURL, {
							method: this.method,
							body: JSON.stringify(build),
							headers: this.headers,
						});
						status = res.status;
						const text = await res.text();
						// An empty success (204) is still a success.
						json = text === "" ? {} : JSON.parse(text);
						if (typeof json !== "object" || json === null) {
							throw new TypeError("expected a JSON object, got " + text.slice(0, 40));
						}
					} catch (e) {
						// No answer, or one that isn't a JSON object (a proxy's error page).
						console.error(e);
						this.showPrimError(I18n.requestFailed(e instanceof Error ? e.message : String(e)));
						return;
					} finally {
						this.inFlight.delete(fetchURL);
					}
					if (await handleCaptcha(json, build, this.captcha)) {
						return await doFetch();
					}
					const match = fetchURL.match(/https?:\/\/[^\/]*\/api/gm);
					if (match && this.tfaCheck) {
						const tried = await handle2fa(json, match[0]);
						if (tried) {
							return await onSubmit(tried);
						}
					}
					if (json.errors && this.errors(json)) {
						return;
					}
					// An error answer is never a success: the form's own handler gets it first.
					if (status < 200 || status >= 300) {
						try {
							if (this.onErrorBody?.(json, status)) return;
						} catch (e) {
							if (e instanceof FormError) {
								this.handleError(e);
								return;
							}
							console.error(e);
						}
						const message = typeof json.message === "string" ? json.message : undefined;
						this.showPrimError(message ?? I18n.requestFailed(String(status)));
						return;
					}
					await onSubmit(json);
				};
				// From here the per-URL guard in doFetch takes over.
				this.subbmitting = false;
				await doFetch();
			} else {
				try {
					await this.onSubmit(build, build);
				} catch (e) {
					if (e instanceof FormError) {
						this.handleError(e);
					}
					return;
				}
			}
			console.warn("needs to be implemented");
		} finally {
			this.subbmitting = false;
		}
	}
	showPrimError(error: string) {
		const pop = new PopUp(error, {goAbove: true, buttons: popUpButtonTypes.dismiss});
		pop.show();
	}
	errors(errors: {
		code: number;
		message: string;
		errors: {[key: string]: {_errors: {message: string; code: string}[]}};
	}) {
		if (!(errors instanceof Object)) {
			return;
		}
		for (const error of Object.keys(errors.errors)) {
			const elm = this.names.get(error);
			const errorMessage = errors.errors[error]?._errors?.[0]?.message;
			if (elm && typeof errorMessage === "string" && this.options.html.get(elm)?.deref()) {
				// Through handleError, so the form's onFormError (e.g. closing a loading dialog) runs.
				this.handleError(new FormError(elm, errorMessage));
				return true;
			}
		}
		return false;
	}
	error(formElm: string, errorMessage: string) {
		const elm = this.names.get(formElm);
		if (elm) {
			const htmlref = this.options.html.get(elm);
			if (htmlref) {
				const html = htmlref.deref();
				if (html) {
					this.makeError(html, errorMessage);
				}
			}
		} else {
			console.warn(formElm + " is not a valid form property");
		}
	}
	makeError(e: HTMLDivElement, message: string) {
		let element = e.getElementsByClassName("suberror")[0] as HTMLElement;
		if (!element) {
			const div = document.createElement("div");
			div.classList.add("suberror", "suberrora");
			e.append(div);
			element = div;
			setTimeout(() => {
				element.scrollIntoView(false);
			}, 100);
		} else {
			element.classList.remove("suberror");
			setTimeout(() => {
				element.classList.add("suberror");
				element.scrollIntoView(false);
			}, 100);
		}
		element.textContent = message;
	}
}
export const enum popUpButtonTypes {
	ok = 1,
	dismiss,
}
export class PopUp extends Dialog {
	constructor(message: string, {buttons = popUpButtonTypes.ok, goAbove = false} = {}) {
		super(message, {goAbove});
		switch (buttons) {
			case popUpButtonTypes.ok:
				this.options.addButtonInput("", I18n.ok(), () => {
					this.hide();
				});
				break;
			case popUpButtonTypes.dismiss:
				this.options.addButtonInput("", I18n.dismiss(), () => {
					this.hide();
				});
				break;
		}
	}
}
class HorizontalRule implements OptionsElement<unknown> {
	constructor() {}
	generateHTML(): HTMLElement {
		return document.createElement("hr");
	}
	watchForChange(_: (arg1: undefined) => void) {
		throw new Error("don't do this");
	}
	submit = () => {};
	value = undefined;
}
class Settings extends Buttons {
	static readonly Buttons = Buttons;
	static readonly Options = Options;
	html!: HTMLElement | null;
	hideButtons: boolean;
	constructor(name: string, hideButtons = false) {
		super(name);
		this.hideButtons = hideButtons;
	}
	addButton(
		name: string,
		{
			ltr = false,
			optName = name,
			noSubmit = false,
			icon,
			fullWidth,
		}: {
			ltr?: boolean;
			optName?: string;
			noSubmit?: boolean;
			icon?: string;
			fullWidth?: boolean;
		} = {},
	): Options {
		const options = new Options(optName, this, {ltr, noSubmit});
		(options as any)._fullWidth = fullWidth;
		this.add(name, options, icon);
		return options;
	}
	show() {
		const background = document.createElement("div");
		background.classList.add("flexttb", "menu", "background");

		const title = document.createElement("h2");
		title.textContent = this.name;
		title.classList.add("settingstitle");
		background.append(title);

		background.append(this.generateHTML(this.hideButtons));

		const back = document.createElement("span");
		back.classList.add("exitsettings", "svgicon", "svg-backReturn", "settingsback");
		back.style.display = "none";
		this._backButton = back;
		back.onclick = () => {
			const buttons = this.buttonList;
			if (!buttons) return;
			const mainArea = buttons.querySelector<HTMLElement>(":scope > .settingsHTMLArea");
			if (!mainArea) return;
			const nestedVisible = mainArea.querySelector<HTMLElement>(
				".settingsHTMLArea:not(.mobileHidden)",
			);
			if (nestedVisible) {
				const nestedSidebar = nestedVisible.previousElementSibling;
				if (
					nestedSidebar instanceof HTMLElement &&
					nestedSidebar.classList.contains("settingbuttons")
				) {
					nestedVisible.classList.add("mobileHidden");
					nestedSidebar.classList.remove("mobileHidden");
				}
				return;
			}
			buttons.querySelector(".settingbuttons")?.classList.remove("mobileHidden");
			mainArea.classList.add("mobileHidden");
			this._hideMobileBack();
		};
		background.append(back);

		const exit = document.createElement("span");
		exit.classList.add("exitsettings", "svgicon", "svg-x");
		background.append(exit);
		exit.onclick = (_) => {
			this.hide();
		};
		background.addEventListener("keyup", (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopImmediatePropagation();
				// Cancel the default action, if needed
				this.hide();
			}
		});
		document.body.append(background);
		background.setAttribute("tabindex", "0");
		background.focus();

		this.html = background;
	}
	hide() {
		if (this.warndiv) {
			this.warndiv.remove();
		}
		if (this.html) {
			const html = this.html;
			html.classList.add("bgRemove");
			html.addEventListener("animationend", (e: AnimationEvent) => {
				if (e.animationName === "bg-out") html.remove();
			});
			this.html = null;
		}
	}
}

export {Settings, OptionsElement, Options, Form, Float};
