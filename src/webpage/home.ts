import {I18n} from "./i18n.js";
import {makeRegister} from "./register.js";
import {getInstances, instancefetch, mobile} from "./utils/utils.js";
import {NotificationSoundManager} from "./utils/notificationSound.js";

NotificationSoundManager.preload().catch((e) => {
	console.error("Failed to preload notification sounds:", e);
});

if (window.location.pathname === "/" || window.location.pathname.startsWith("/index")) {
	console.log(mobile);
	const serverbox = document.getElementById("instancebox") as HTMLDivElement;
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					entry.target.classList.add("visible");
					observer.unobserve(entry.target);
				}
			}
		},
		{threshold: 0.1},
	);
	requestAnimationFrame(() => {
		for (const box of document.querySelectorAll(".pagebox")) {
			observer.observe(box);
		}
	});

	(async () => {
		await I18n.done;
		I18n.translatePage();
	})();

	const SKELETON_COUNT = 6;
	for (let i = 0; i < SKELETON_COUNT; i++) {
		const skeleton = document.createElement("div");
		skeleton.classList.add("instance-skeleton", "skeleton");
		serverbox.append(skeleton);
	}

	(async () => {
		try {
			await instancefetch;
			const instances = getInstances();
			if (instances.length === 0) throw new Error("instances.json is missing or empty");
			serverbox.innerHTML = "";
			await I18n.done;
			for (const instance of instances) {
				if (instance.display === false) {
					continue;
				}
				const div = document.createElement("div");
				div.classList.add("flexltr", "instance");
				if (instance.image) {
					const img = document.createElement("img");
					img.alt = I18n.home.icon(instance.name);
					img.src = instance.image;
					div.append(img);
				}
				const statbox = document.createElement("div");
				statbox.classList.add("flexttb", "flexgrow");

				{
					const textbox = document.createElement("div");
					textbox.classList.add("flexttb", "instancetextbox");
					const title = document.createElement("h2");
					title.innerText = instance.name;
					textbox.append(title);
					if (instance.description) {
						const p = document.createElement("p");
						p.innerText = instance.description;
						textbox.append(p);
					}
					statbox.append(textbox);
				}
				div.append(statbox);
				div.onclick = (_) => {
					makeRegister(true, instance.url || instance.name);
				};
				serverbox.append(div);
			}
		} catch {
			serverbox.innerHTML = "";
			const errorEl = document.createElement("div");
			errorEl.classList.add("instance-error");
			errorEl.textContent = I18n.htmlPages.instanceError();
			serverbox.append(errorEl);
		}
	})();

	const slides = document.getElementById("ScreenshotSlides");
	if (slides) {
		const images = Array.from(slides.getElementsByTagName("img"));
		const left = slides.getElementsByClassName("leftArrow").item(0) as HTMLElement;
		const right = slides.getElementsByClassName("rightArrow").item(0) as HTMLElement;
		let index = 0;
		let timeout: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {});
		function slideShow() {
			let cleared = false;
			if (timeout !== undefined) {
				cleared = true;
				clearTimeout(timeout);
			}
			let i = 0;
			for (const img of images) {
				if (i !== index) {
					img.classList.add("hidden");
				} else {
					img.classList.remove("hidden");
				}
				i++;
			}
			const count = document.getElementById("slideCount");
			if (count) {
				if (count.children.length !== images.length) {
					count.innerHTML = "";
					for (let i = 0; i < images.length; i++) {
						const dot = document.createElement("span");
						const outer = document.createElement("div");
						outer.onclick = () => {
							index = i;
							slideShow();
						};
						outer.append(dot);
						count.append(outer);
					}
				}
				let i = 0;
				for (const child of Array.from(count.children)) {
					if (i === index) {
						child.classList.add("selected");
					} else {
						child.classList.remove("selected");
					}
					i++;
				}
			}

			timeout = setTimeout(
				() => {
					index = (index + 1) % images.length;
					timeout = undefined;
					slideShow();
				},
				cleared ? 15000 : 30000,
			);
		}
		slideShow();
		left.onclick = () => {
			index = (index - 1 + images.length) % images.length;
			slideShow();
		};
		right.onclick = () => {
			index = (index + 1) % images.length;
			slideShow();
		};
	}
}
