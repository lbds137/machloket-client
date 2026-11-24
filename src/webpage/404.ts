import {I18n} from "./i18n";
import {setTheme, SW} from "./utils/utils";
import {reloadIfWorkerServes} from "./utils/notFoundReload";
import {pageNav} from "./utils/netUtils.js";
if (document.getElementById("404-page")) {
	await setTheme();
	await I18n.done;
	I18n.translatePage();

	const easterEvents = [
		() => {
			window.open("https://youtube.com/watch?v=dQw4w9WgXcQ");
		},
		() => {
			window.open("https://youtube.com/watch?v=fC7oUOUEEi4");
		},
		() => {
			alert(I18n[404].whatelse());
		},
	];

	const where = document.getElementById("whereever");
	if (where) {
		where.onclick = () => {
			const event = easterEvents[Math.floor(Math.random() * easterEvents.length)];
			event();
		};
	}
	await reloadIfWorkerServes({
		url: window.location.href,
		hasWorker: () => SW.worker?.state === "activated",
		isValid: (url) => SW.isValid(url),
		// The app's reload, which keeps accounts kept for this session only (a plain reload
		// signs them out; a navigation to a URL with a #fragment only scrolls).
		reload: () => pageNav.reload(),
		storage: () => sessionStorage,
	});
}
