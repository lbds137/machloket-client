import {I18n} from "./i18n";
import {setTheme} from "./utils/utils";

setTheme();
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
