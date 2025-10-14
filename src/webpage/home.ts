import {I18n} from "./i18n.js";
import {makeRegister} from "./register.js";
import {mobile} from "./utils/utils.js";
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
const recent = document.getElementById("recentBlog");
if (recent) {
	fetch("https://blog.fermi.chat/feed_json_created.json")
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
fetch("/instances.json")
	.then((_) => _.json())
	.then(
		async (
			json: {
				name: string;
				description?: string;
				descriptionLong?: string;
				image?: string;
				url?: string;
				display?: boolean;
				online?: boolean;
				uptime: {alltime: number; daytime: number; weektime: number};
				urls: {
					wellknown: string;
					api: string;
					cdn: string;
					gateway: string;
					login?: string;
				};
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
					if (instance.online !== undefined) {
						const status = document.createElement("span");
						status.innerText = instance.online ? "Online" : "Offline";
						status.classList.add("instanceStatus");
						title.append(status);
					}
					textbox.append(title);
					if (instance.description || instance.descriptionLong) {
						const p = document.createElement("p");
						if (instance.descriptionLong) {
							p.innerText = instance.descriptionLong;
						} else if (instance.description) {
							p.innerText = instance.description;
						}
						textbox.append(p);
					}
					statbox.append(textbox);
				}
				if (instance.uptime) {
					const stats = document.createElement("div");
					stats.classList.add("flexltr");
					const span = document.createElement("span");
					span.innerText = I18n.home.uptimeStats(
						Math.round(instance.uptime.alltime * 100) + "",
						Math.round(instance.uptime.weektime * 100) + "",
						Math.round(instance.uptime.daytime * 100) + "",
					);
					stats.append(span);
					statbox.append(stats);
				}
				div.append(statbox);
				div.onclick = (_) => {
					if (instance.online !== false) {
						makeRegister(true, instance.name);
					} else {
						alert(I18n.home.warnOffiline());
					}
				};
				serverbox.append(div);
			}
		},
	);
