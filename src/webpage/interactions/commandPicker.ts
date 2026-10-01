import {bumpCommandRecency, getCommandRecency, recentFirst} from "../commandRecency.js";
import type {Command} from "./commands.js";
import {I18n} from "../i18n.js";
import type {applicationJson} from "../jsontypes.js";
import type {Localuser} from "../localuser.js";
import {CDNParams} from "../utils/cdnParams.js";

/** Discord's command-picker browse view (an empty "/" query): a rail of tabs — Frequently
 * Used first, then one icon per app, alphabetical — beside a body of per-app sections. A
 * rail tab filters the body to its app (titled by it); Frequently Used leads with the last
 * few used commands, then every app's section. Rows are name over description with the
 * app's name at the far edge. A non-empty query never reaches this panel; it gets the flat
 * best-match list in findCommands. */

/** The app's icon, or its initial when the index carried none. */
export function appIconElm(
	localuser: Localuser,
	app: applicationJson | undefined,
): HTMLElement {
	if (app?.icon) {
		const img = document.createElement("img");
		img.src =
			localuser.info.cdn +
			"/app-icons/" +
			app.id +
			"/" +
			app.icon +
			".png" +
			new CDNParams({expectedSize: 32});
		img.alt = "";
		img.loading = "lazy";
		return img;
	}
	const letter = document.createElement("span");
	letter.classList.add("commandAppIconFallback");
	letter.textContent = (app?.name || "?").slice(0, 1).toUpperCase();
	return letter;
}

/** One app's slice of the picker: its index row and the commands credited to it. */
type Group = {
	app: applicationJson | undefined;
	name: string;
	commands: Command[];
};

export function renderCommandPanel(
	localuser: Localuser,
	box: HTMLDivElement,
	commands: Command[],
	apps: applicationJson[] | undefined,
) {
	const recency = getCommandRecency();
	const recent = recentFirst(
		commands.filter((_) => recency[_.name]),
		recency,
	).slice(0, 5);
	// One group per application, alphabetical by name; a command whose app has no row in the
	// index still groups (under an unknown name) so it never disappears from the picker.
	const byId = new Map<string, Group>();
	for (const command of commands) {
		const app = apps?.find((_) => _.id === command.applicationId);
		let group = byId.get(command.applicationId);
		if (!group) {
			group = {app, name: app?.name || "?", commands: []};
			byId.set(command.applicationId, group);
		}
		group.commands.push(command);
	}
	const groups = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
	for (const group of groups) {
		group.commands.sort((a, b) => a.name.localeCompare(b.name));
	}

	const panel = document.createElement("div");
	panel.classList.add("searchPanel");
	const rail = document.createElement("div");
	rail.classList.add("searchRail");
	const body = document.createElement("div");
	body.classList.add("searchBody");
	panel.append(rail, body);

	const pick = (command: Command) => {
		bumpCommandRecency(command.name);
		// The pick closes the popup — the composer is now a command.
		box.replaceChildren();
		localuser.channelfocus?.startCommand(command);
	};

	const row = (command: Command) => {
		const group = byId.get(command.applicationId);
		const div = document.createElement("div");
		div.classList.add("commandRow");
		div.append(appIconElm(localuser, group?.app));
		const text = document.createElement("div");
		text.classList.add("commandRowText");
		const name = document.createElement("span");
		// The name span is exactly "/name" — commit-on-space matches on that text.
		name.classList.add("commandRowName");
		name.textContent = `/${command.localizedName}`;
		const desc = document.createElement("span");
		desc.classList.add("commandRowDesc");
		desc.textContent = command.localizedDescription;
		text.append(name, desc);
		div.append(text);
		const appName = document.createElement("span");
		appName.classList.add("commandRowApp");
		appName.textContent = group?.name ?? "";
		div.append(appName);
		div.onclick = () => pick(command);
		return div;
	};

	const section = (title: string, rows: HTMLDivElement[]) => {
		const div = document.createElement("div");
		div.classList.add("searchSection");
		const head = document.createElement("div");
		head.classList.add("searchSectionTitle");
		head.textContent = title;
		div.append(head, ...rows);
		return div;
	};

	// A tab is either the recents view (when anything was used) or one app's filter.
	type Tab = {label: string; icon: () => HTMLElement; render: () => void};
	const tabs: Tab[] = [];
	if (recent.length) {
		tabs.push({
			label: I18n.commands.frequentlyUsed(),
			icon: clockIcon,
			render: () => {
				body.replaceChildren(
					section(I18n.commands.frequentlyUsed(), recent.map(row)),
					...groups.map((group) => section(group.name, group.commands.map(row))),
				);
			},
		});
	}
	for (const group of groups) {
		tabs.push({
			label: group.name,
			icon: () => appIconElm(localuser, group.app),
			render: () => {
				const title = document.createElement("div");
				title.classList.add("searchPanelTitle");
				title.append(appIconElm(localuser, group.app));
				const label = document.createElement("span");
				label.textContent = group.name;
				title.append(label);
				const sub = document.createElement("div");
				sub.classList.add("searchPanelSubtitle");
				sub.textContent = group.app?.description || "";
				body.replaceChildren(
					title,
					sub,
					section(I18n.commands.appCommands(), group.commands.map(row)),
				);
			},
		});
	}

	let active = 0;
	let selected = 0;
	let rows: HTMLDivElement[] = [];
	const railButtons: HTMLDivElement[] = [];

	if (!tabs.length) {
		// Nothing to browse (a command-less guild, an empty scoped index, only type-2/3
		// commands): the empty popup, handlers down — the flat list's behavior, and no
		// wrecked panel holding the keyboard.
		box.replaceChildren();
		localuser.keyup = () => false;
		localuser.keydown = () => {};
		return;
	}

	const select = (i: number) => {
		rows[selected]?.classList.remove("commandRowSelected");
		selected = Math.max(0, Math.min(rows.length - 1, i));
		const current = rows[selected];
		if (current) {
			current.classList.add("commandRowSelected");
			current.scrollIntoView({block: "nearest"});
		}
	};
	const switchTab = (i: number) => {
		active = Math.max(0, Math.min(tabs.length - 1, i));
		tabs[active].render();
		rows = [...body.querySelectorAll(".commandRow")] as HTMLDivElement[];
		select(0);
		railButtons.forEach((button, j) =>
			button.classList.toggle("searchRailButtonSelected", j === active),
		);
	};

	for (const [i, tab] of tabs.entries()) {
		const button = document.createElement("div");
		button.classList.add("searchRailButton");
		button.setAttribute("role", "tab");
		button.setAttribute("aria-label", tab.label);
		button.append(tab.icon());
		button.onclick = () => switchTab(i);
		railButtons.push(button);
		rail.append(button);
	}
	box.replaceChildren(panel);

	// Keyboard, Discord's shape: Left/Right walk the rail tabs, Up/Down the rows, Enter/Tab
	// run the selected row. The handlers stand down once the popup is cleared (Escape).
	const nav = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Tab"]);
	const standing = () => {
		if (!box.childElementCount) {
			localuser.keyup = () => false;
			localuser.keydown = () => {};
			return true;
		}
		return false;
	};
	localuser.keyup = (event) => {
		if (standing()) return false;
		switch (event.key) {
			case "ArrowUp":
				select(selected - 1);
				return true;
			case "ArrowDown":
				select(selected + 1);
				return true;
			case "ArrowLeft":
				switchTab(active - 1);
				return true;
			case "ArrowRight":
				switchTab(active + 1);
				return true;
			case "Enter":
			case "Tab":
				rows[selected]?.click();
				return true;
		}
		return false;
	};
	localuser.keydown = (event) => {
		if (standing()) return;
		if (nav.has(event.key)) event.preventDefault();
	};
	switchTab(0);
}

function clockIcon(): HTMLElement {
	const span = document.createElement("span");
	span.innerHTML =
		'<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
	return span;
}
