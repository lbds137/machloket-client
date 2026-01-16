import {I18n} from "./i18n";
import {setTheme, SW} from "./utils/utils";
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
	while (true) {
		await new Promise((res) => setTimeout(res, 100));

		if (SW.worker) {
			const valid = await SW.isValid(window.location.href);
			if (valid) {
				window.location.reload();
			}
			break;
		}
	}
}
