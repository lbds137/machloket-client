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
		// A navigation to this URL, not a reload: the worker serves it all the same, and a reload
		// would sign out accounts kept for this session only.
		reload: () => pageNav.go(window.location.href),
		storage: () => sessionStorage,
	});
}
