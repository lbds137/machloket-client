import {File} from "./file.js";
import {removeAni} from "./utils/utils.js";

class ImagesDisplay {
	files: File[];
	index = 0;
	constructor(files: File[], index = 0) {
		this.files = files;
		this.index = index;
	}
	weakbg = new WeakRef<HTMLElement>(document.createElement("div"));
	get background(): HTMLElement | undefined {
		return this.weakbg.deref();
	}
	set background(e: HTMLElement) {
		this.weakbg = new WeakRef(e);
	}
	makeHTML(): HTMLElement {
		const imageWrapper = document.createElement("div");
		const image = this.files[this.index].getHTML(false, true);
		imageWrapper.classList.add("imgfit", "centeritem");
		imageWrapper.appendChild(image);

		let scale = 1;
		let translateX = 0;
		let translateY = 0;
		let dragging = false;
		let clickedAfterDrag = false;
		const dragThreshold = 5;
		const pointers = new Map<number, {x: number; y: number}>();
		let initialDistance = 0;
		let pinchStartScale = 1;

		const imageElement = imageWrapper.querySelector("img");
		const updateTransform = () => {
			if (!imageElement) return;
			imageElement.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
		};

		const reset = () => {
			scale = 1;
			translateX = 0;
			translateY = 0;
			updateTransform();
		};

		const getDistance = (a: {x: number; y: number}, b: {x: number; y: number}) =>
			Math.hypot(a.x - b.x, a.y - b.y);

		imageWrapper.onwheel = (event) => {
			event.preventDefault();
			const delta = Math.sign(event.deltaY) * -0.15;
			const oldScale = scale;
			scale = Math.max(0.5, Math.min(10, scale + delta));
			if (!imageElement || scale === oldScale) return;
			const rect = imageWrapper.getBoundingClientRect();
			const offsetX = event.clientX - rect.left - rect.width / 2;
			const offsetY = event.clientY - rect.top - rect.height / 2;
			translateX -= offsetX * (scale / oldScale - 1);
			translateY -= offsetY * (scale / oldScale - 1);
			updateTransform();
		};

		imageWrapper.onpointerdown = (event) => {
			if (event.button !== 0 && event.pointerType !== "touch") return;
			event.preventDefault();
			pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
			imageWrapper.setPointerCapture(event.pointerId);
			if (pointers.size === 1) {
				dragging = true;
			} else if (pointers.size === 2) {
				dragging = false;
				const [a, b] = Array.from(pointers.values());
				initialDistance = getDistance(a, b);
				pinchStartScale = scale;
			}
			imageWrapper.classList.add("dragging");
		};

		imageWrapper.onpointermove = (event) => {
			if (!pointers.has(event.pointerId)) return;
			event.preventDefault();
			const previous = pointers.get(event.pointerId)!;
			const dx = event.clientX - previous.x;
			const dy = event.clientY - previous.y;
			pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
			if (pointers.size === 2) {
				const [a, b] = Array.from(pointers.values());
				const currentDistance = getDistance(a, b);
				const newScale = Math.max(
					0.5,
					Math.min(10, pinchStartScale * (currentDistance / initialDistance)),
				);
				if (newScale !== scale && imageElement) {
					const rect = imageWrapper.getBoundingClientRect();
					const center = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
					const offsetX = center.x - rect.left - rect.width / 2;
					const offsetY = center.y - rect.top - rect.height / 2;
					translateX -= offsetX * (newScale / scale - 1);
					translateY -= offsetY * (newScale / scale - 1);
					scale = newScale;
					updateTransform();
				}
			} else if (dragging) {
				if (Math.abs(dx) > dragThreshold || Math.abs(dy) > dragThreshold) {
					clickedAfterDrag = true;
				}
				translateX += dx;
				translateY += dy;
				updateTransform();
			}
		};

		imageWrapper.onpointerup = (event) => {
			if (event.pointerId) {
				imageWrapper.releasePointerCapture(event.pointerId);
			}
			pointers.delete(event.pointerId);
			if (pointers.size === 1) {
				dragging = true;
			} else {
				dragging = false;
			}
			imageWrapper.classList.remove("dragging");
		};

		imageWrapper.onpointercancel = () => {
			dragging = false;
			pointers.clear();
			imageWrapper.classList.remove("dragging");
		};

		imageWrapper.addEventListener("click", (event) => {
			if (clickedAfterDrag) {
				event.stopPropagation();
				clickedAfterDrag = false;
			}
		});

		imageWrapper.ondblclick = () => {
			if (scale > 1) {
				reset();
			} else {
				scale = 2;
				updateTransform();
			}
		};

		if (imageElement) {
			imageElement.addEventListener("click", (e) => {
				e.stopPropagation();
			});
		}

		return imageWrapper;
	}
	show() {
		this.background = document.createElement("div");
		this.background.classList.add("background");
		let cur = this.makeHTML();
		if (this.files.length !== 1) {
			const right = document.createElement("span");
			right.classList.add("rightArrow", "svg-intoMenu");
			right.onclick = (e) => {
				e.preventDefault();
				e.stopImmediatePropagation();
				this.index++;
				this.index %= this.files.length;
				cur.remove();
				cur = this.makeHTML();
				if (this.background) {
					this.background.appendChild(cur);
				}
			};

			const left = document.createElement("span");
			left.onclick = (e) => {
				e.preventDefault();
				e.stopImmediatePropagation();
				this.index += this.files.length - 1;
				this.index %= this.files.length;
				cur.remove();
				cur = this.makeHTML();
				if (this.background) {
					this.background.appendChild(cur);
				}
			};
			left.classList.add("leftArrow", "svg-leftArrow");
			this.background.append(right, left);
			this.background.addEventListener("keydown", (e) => {
				if (e.key === "ArrowRight") {
					e.preventDefault();
					e.stopImmediatePropagation();
					right.click();
				}
				if (e.key === "ArrowLeft") {
					e.preventDefault();
					e.stopImmediatePropagation();
					left.click();
				}
			});
		}

		this.background.appendChild(cur);
		this.background.onclick = (event) => {
			if (event.target === this.background || event.target === cur) {
				this.hide();
			}
		};
		this.background.onkeydown = (e) => {
			if (e.key === "Escape") {
				this.hide();
			}
		};
		document.body.append(this.background);
		this.background.setAttribute("tabindex", "0");
		this.background.focus();
	}
	hide() {
		if (this.background) {
			removeAni(this.background);
		}
	}
}
export {ImagesDisplay};
