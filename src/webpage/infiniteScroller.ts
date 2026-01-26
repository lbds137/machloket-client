class InfiniteScroller {
	readonly getIDFromOffset: (ID: string, offset: number) => Promise<string | undefined>;
	readonly getHTMLFromID: (ID: string) => Promise<HTMLElement>;
	readonly destroyFromID: (ID: string) => Promise<boolean>;
	readonly reachesBottom: () => void;

	private weakDiv = new WeakRef(document.createElement("div"));
	private curFocID?: string;
	private curElms = new Map<string, HTMLElement>();
	private backElm = new Map<string, string | undefined>();
	private forElm = new Map<string, string | undefined>();
	private weakElmId = new WeakMap<HTMLElement, string>();

	get div() {
		return this.weakDiv.deref();
	}
	set div(div: HTMLDivElement | undefined) {
		this.weakDiv = new WeakRef(div || document.createElement("div"));
	}
	get scroller() {
		return this.div?.children[0] as HTMLDivElement | undefined;
	}

	constructor(
		getIDFromOffset: InfiniteScroller["getIDFromOffset"],
		getHTMLFromID: InfiniteScroller["getHTMLFromID"],
		destroyFromID: InfiniteScroller["destroyFromID"],
		reachesBottom: InfiniteScroller["reachesBottom"] = () => {},
	) {
		this.getIDFromOffset = getIDFromOffset;
		this.getHTMLFromID = getHTMLFromID;
		this.destroyFromID = destroyFromID;
		this.reachesBottom = reachesBottom;
	}
	observer: IntersectionObserver = new IntersectionObserver(console.log);

	private createObserver(root: HTMLDivElement) {
		const scroller = root.children[0];
		function sorted() {
			return Array.from(scroller.children).filter((_) => visable.has(_)) as HTMLElement[];
		}
		const visable = new Set<Element>();
		this.observer = new IntersectionObserver(
			(obvs) => {
				for (const obv of obvs) {
					if (obv.target instanceof HTMLElement) {
						if (obv.isIntersecting) {
							visable.add(obv.target);
						} else {
							visable.delete(obv.target);
						}
					}
				}
				for (const obv of obvs) {
					if (obv.target instanceof HTMLElement) {
						const id = this.weakElmId.get(obv.target);
						if (id && !obv.isIntersecting && id === this.curFocID) {
							const elms = sorted();

							const middle = elms[(elms.length / 2) | 0];
							console.log(obv.target, middle, elms);
							const id = this.weakElmId.get(middle);
							if (!id) continue;
							this.curFocID = id;
							this.fillIn(true);
						} else if (!id) console.log("uh...");
					}
				}
			},
			{root, threshold: 0.1},
		);
	}

	async getDiv(initialId: string, flash = false): Promise<HTMLDivElement> {
		const div = document.createElement("div");
		div.classList.add("scroller");
		this.div = div;

		const scroll = document.createElement("div");
		div.append(scroll);

		this.createObserver(div);

		this.focus(initialId, flash, true);
		return div;
	}

	async addedBottom(): Promise<void> {}

	snapBottom(): () => void {
		const scrollBottom = this.scrollBottom;
		return () => {
			if (this.div && scrollBottom < 4) {
				this.div.scrollTop = this.div.scrollHeight;
			}
		};
	}

	deleteId(id: string) {
		this.removeElm(id);
	}

	private async clearElms() {
		await Promise.all(this.curElms.keys().map((id) => this.destroyFromID(id)));
		this.curElms.clear();
		this.backElm.clear();
		this.forElm.clear();
		const scroller = this.scroller;
		if (!scroller) return;
		scroller.innerHTML = "";
	}

	private async removeElm(id: string) {
		const back = this.backElm.get(id);
		console.log(id, back, "back");
		if (back) this.forElm.delete(back);

		const forward = this.forElm.get(id);
		console.log(id, forward, "for");
		if (forward) this.backElm.delete(forward);

		// This purposefully leaves all references pointing out alone so nothing breaks
		const elm = this.curElms.get(id);
		this.curElms.delete(id);
		await this.destroyFromID(id);
		elm?.remove();
	}
	private async getFromID(id: string) {
		if (this.curElms.has(id)) {
			return this.curElms.get(id) as HTMLElement;
		}
		const elm = await this.getHTMLFromID(id);
		this.curElms.set(id, elm);
		this.weakElmId.set(elm, id);
		this.observer.observe(elm);
		return elm;
	}
	private checkIDs() {
		const scroll = this.scroller;
		if (!scroll) return;
		const kids = Array.from(scroll.children)
			.map((_) => this.weakElmId.get(_ as HTMLElement))
			.filter((_) => _ !== undefined);
		let last = null;
		for (const kid of kids) {
			if (last === null) {
				last = kid;
			} else {
				if (this.backElm.get(last) !== kid)
					console.log("back is wrong", kid, this.backElm.get(kid));
				if (this.forElm.get(kid) !== last)
					console.log("for is wrong", last, this.backElm.get(last));
				last = kid;
			}
		}
		const e = new Set(this.curElms.keys());
		if (e.symmetricDifference(new Set(kids)).size)
			console.log("cur elms is wrong", e.symmetricDifference(new Set(kids)));
	}
	private addLink(prev: string | undefined, next: string | undefined) {
		if (prev) this.forElm.set(prev, next);
		if (next) this.backElm.set(next, prev);
	}
	private async fillInTop() {
		const scroll = this.scroller;
		if (!scroll) return;
		let top = this.curFocID;
		const futElms: Promise<HTMLElement>[] = [];
		let count = 0;
		let limit = 50;
		while (top) {
			count++;
			if (count > 100) {
				const list: string[] = [];
				while (top) {
					list.push(top);
					console.log("top");
					top = this.forElm.get(top);
				}
				console.log(list, top);
				list.forEach((_) => this.removeElm(_));
				break;
			}
			if (this.forElm.has(top) && this.curElms.has(top)) {
				top = this.forElm.get(top);
			} else if (count > limit) {
				break;
			} else {
				limit = 75;
				const id = await this.getIDFromOffset(top, 1);
				this.addLink(top, id);

				if (id) {
					futElms.push(this.getFromID(id));
				}
				top = id;
			}
		}
		for (const elmProm of futElms) {
			const elm = await elmProm;
			scroll.prepend(elm);
		}
	}
	private async fillInBottom() {
		const scroll = this.scroller;
		if (!scroll) return;
		let bottom = this.curFocID;
		const backElms: [string, Promise<HTMLElement>, string][] = [];
		let count = 0;
		let limit = 50;
		while (bottom) {
			count++;
			if (count > 100) {
				const list: string[] = [];
				while (bottom) {
					list.push(bottom);
					console.log("bottom");
					bottom = this.backElm.get(bottom);
				}
				console.log(list, bottom);
				list.forEach((_) => this.removeElm(_));
				break;
			}
			if (this.backElm.has(bottom) && this.curElms.has(bottom)) {
				if (limit === 75) throw new Error("patchy?");
				bottom = this.backElm.get(bottom);
			} else if (count > limit) {
				break;
			} else {
				limit = 75;
				const id = await this.getIDFromOffset(bottom, -1);
				this.addLink(id, bottom);

				if (id) {
					if (this.curElms.has(id)) debugger;
					console.log(this.curElms.has(bottom));
					backElms.push([id, this.getFromID(id), bottom]);
				}
				bottom = id;
			}
		}
		for (const [id, elmProm] of backElms) {
			const elm = await elmProm;
			if (!this.curElms.has(id)) console.error("bottom is missing");
			scroll.append(elm);
		}
		console.log(backElms);
	}

	filling?: Promise<void>;
	private async fillIn(refill = false) {
		if (this.filling && !refill) {
			return this.filling;
		}
		await this.filling;

		const fill = new Promise<void>(async (res) => {
			await Promise.all([this.fillInTop(), this.fillInBottom()]);
			res();
			if (this.filling === fill) {
				this.filling = undefined;
			}
			this.checkIDs();
		});
		this.filling = fill;
		return fill;
	}

	async focus(id: string, flash = true, sec = false): Promise<void> {
		const scroller = this.scroller;
		if (!scroller) return;
		await this.clearElms();

		let div = this.curElms.get(id);
		let had = true;

		if (!div) {
			had = false;
			const obj = await this.getFromID(id);
			scroller.append(obj);
			this.curFocID = id;
			await this.fillIn(true);
			div = obj;
		}
		if (had && !sec) {
			div.scrollIntoView({
				behavior: "smooth",
				inline: "center",
				block: "center",
			});
		} else {
			div.scrollIntoView({
				block: "center",
			});
		}

		if (flash) {
		}
	}

	async delete(): Promise<void> {}
}

export {InfiniteScroller};
