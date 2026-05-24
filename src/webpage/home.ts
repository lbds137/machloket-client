import {I18n} from "./i18n.js";
import {makeRegister} from "./register.js";
import {mobile} from "./utils/utils.js";

type PingHistory = {
	rows?: {status: string | number; created_at?: string}[];
	graph?: {points?: {status: string | number}[]};
};

function isSuccessStatus(status: string | number) {
	return String(status).startsWith("2");
}

function computeUptime(entries: {status: string | number; created_at?: string}[]) {
	if (entries.length === 0) return null;
	const success = entries.filter((entry) => isSuccessStatus(entry.status)).length;
	return Math.round((success / entries.length) * 100);
}

async function loadInstanceUptime(instanceId: string) {
	const response = await fetch(
		`https://spacebar-explorer.sovr.top/api/ping?instanceId=${encodeURIComponent(instanceId)}&limit=168&graph=1`,
	);
	if (!response.ok) return null;
	const data = (await response.json()) as PingHistory;
	const rows = data.rows ?? [];
	const all = computeUptime((data.graph?.points ?? rows) as {status: string | number}[]);
	const now = Date.now();
	const week = computeUptime(
		rows.filter((row) => row.created_at && Date.parse(row.created_at) >= now - 7 * 24 * 60 * 60 * 1000),
	);
	const day = computeUptime(
		rows.filter((row) => row.created_at && Date.parse(row.created_at) >= now - 24 * 60 * 60 * 1000),
	);
	if (all === null || week === null || day === null) return null;
	return {all, week, day};
}

if (window.location.pathname === "/" || window.location.pathname.startsWith("/index")) {
	console.log(mobile);
	const serverbox = document.getElementById("instancebox") as HTMLDivElement;

	(async () => {
		await I18n.done;
		const box1Items = document.getElementById("box1Items");
		I18n.translatePage();

		if (box1Items) {
			const items = I18n.htmlPages.box1Items().split("|");
			let i = 0;
			//@ts-ignore ts is being dumb here
			for (const item of box1Items.children) {
				(item as HTMLElement).textContent = items[i];
				i++;
			}
		}
	})();
	/*
	const recent = document.getElementById("recentBlog");
	if (recent) {
		fetch("https://blog.fermo.sovr.top/feed_json_created.json")
			.then((_) => _.json())
			.then(
				(json: {
					items: {
						url: string;
						title: string;
						content_html: string;
					}[];
				}) => {
					for (const thing of json.items.slice(0, 5)) {
						const a = document.createElement("a");
						a.href = thing.url;
						a.textContent = thing.title;
						recent.append(a);
					}
				},
			);
	}
	*/
	fetch("https://spacebar-explorer.sovr.top/api/catalog/instances")
		.then((_) => _.json())
		.then(
			async (
				json: {
					id: string;
					name: string;
					tags?: string[];
					short?: string;
					description?: string;
					display?: boolean;
					icon?: string;
					images?: string[];
					level?: number;
					link?: string;
				}[],
			) => {
				await I18n.done;
				console.warn(json);
				for (const instance of json) {
					if (instance.display === false) {
						continue;
					}
					const div = document.createElement("div");
					div.classList.add("flexltr", "instance");
					const image = instance.icon || instance.images?.[0];
					if (image) {
						const img = document.createElement("img");
						img.alt = I18n.home.icon(instance.name);
						img.src = new URL(image, "https://spacebar-explorer.sovr.top").href;
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
						if (instance.short || instance.description) {
							const p = document.createElement("p");
							if (instance.description) {
								p.innerText = instance.description;
							} else if (instance.short) {
								p.innerText = instance.short;
							}
							textbox.append(p);
						}
						statbox.append(textbox);
					}
						{
							const stats = document.createElement("div");
							stats.classList.add("flexltr");
							const span = document.createElement("span");
							stats.append(span);
							statbox.append(stats);
							loadInstanceUptime(instance.id)
								.then((uptime) => {
									if (!uptime) {
										stats.remove();
										return;
									}
									span.innerText = I18n.home.uptimeStats(
										uptime.all + "",
										uptime.week + "",
										uptime.day + "",
									);
								})
								.catch(() => {
									stats.remove();
								});
						}
					div.append(statbox);
					div.onclick = (_) => {
						makeRegister(true, instance.name);
					};
					serverbox.append(div);
				}
			},
		);

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
