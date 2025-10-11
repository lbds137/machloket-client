import {Contextmenu} from "./contextmenu.js";
import {MarkDown} from "./markdown.js";

class Hover {
	str: string | MarkDown | (() => Promise<MarkDown | string> | MarkDown | string);
	customHTML?: () => HTMLElement;
	weak: boolean;
	constructor(
		txt: string | MarkDown | (() => Promise<MarkDown | string> | MarkDown | string),
		{customHTML, weak}: {customHTML?: () => HTMLElement; weak: boolean} = {weak: true},
	) {
		this.customHTML = customHTML;
		this.weak = weak;
		this.str = txt;
	}
	static map = new WeakMap<HTMLElement, () => void>();
	static elm: HTMLElement = document.createElement("div");
	static bound: HTMLElement = document.createElement("div");
	static timeout: NodeJS.Timeout;
	static watchForGone() {
		clearInterval(this.timeout);
		this.timeout = setInterval(() => {
			if (!document.contains(this.bound)) {
				this.elm.remove();
				clearInterval(this.timeout);
			}
		}, 100);
	}
	get elm2() {
		return Hover.elm;
	}
	set elm2(elm: HTMLElement) {
		Hover.elm = elm;
	}
	addEvent(elm: HTMLElement) {
		const tempy = (Math.random() * 1000) ^ 0;
		let timeOut = setTimeout(() => {}, 0);
		const RM = () => {
			this.elm2.remove();
		};

		elm.addEventListener("mouseover", () => {
			clearTimeout(timeOut);
			timeOut = setTimeout(async () => {
				console.log(this.elm2);
				RM();
				this.elm2 = await this.makeHover(elm);
				Hover.bound = elm;
				Hover.watchForGone();
				console.error(this.elm2, tempy, document.contains(elm), elm);
			}, 300);
		});
		elm.addEventListener("mouseout", () => {
			clearTimeout(timeOut);
			RM();
		});
		new MutationObserver((e) => {
			if (e[0].removedNodes.length) {
				console.error("Hi :3", this.elm2, tempy, document.contains(elm), e[0]);
				clearTimeout(timeOut);
				RM();
			}
		}).observe(elm, {childList: true});
		Hover.map.get(elm)?.();
		Hover.map.set(elm, () => {
			alert("happened");
			clearTimeout(timeOut);
			this.elm2.remove();
		});
	}
	async makeHover(elm: HTMLElement) {
		if (!document.contains(elm)) return document.createElement("div");
		const div = document.createElement("div");

		if (this.customHTML) {
			div.append(this.customHTML());
		} else {
			if (this.str instanceof MarkDown) {
				div.append(this.str.makeHTML());
			} else if (this.str instanceof Function) {
				const hover = await this.str();
				if (hover instanceof MarkDown) {
					div.append(hover.makeHTML());
				} else {
					div.innerText = hover;
				}
			} else {
				div.innerText = this.str;
			}
		}

		const box = elm.getBoundingClientRect();
		div.style.top = box.bottom + 4 + "px";
		div.style.left = Math.floor(box.left + box.width / 2) + "px";
		div.classList.add("hoverthing");
		if (this.weak) {
			div.addEventListener("mouseover", () => {
				div.remove();
			});
		}
		document.body.append(div);
		Contextmenu.keepOnScreen(div);
		return div;
	}
}
export {Hover};
