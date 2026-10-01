import {bumpCommandRecency, getCommandRecency} from "../commandRecency.js";
import type {Command, CommandInvocation} from "./commands.js";
import {I18n} from "../i18n.js";
import type {applicationJson} from "../jsontypes.js";
import type {Localuser} from "../localuser.js";
import {CDNParams} from "../utils/cdnParams.js";

/** Discord's command-picker browse view (an empty "/" query): a rail of tabs — Frequently
 * Used first, then one icon per app, alphabetical — beside a body of per-app sections. A
 * rail tab filters the body to its app (titled by it); Frequently Used leads with the last
 * few used commands, then every app's section. Rows are one per runnable path — subcommands
 * list individually ("/name sub"), name over description with the app's name at the far
 * edge. A non-empty query never reaches this panel; it gets the flat best-match list in
 * findCommands. */

/** The row's label: "/name", "/name sub" or "/name group sub". */
export function invocationLabel(inv: CommandInvocation): string {
	return "/" + [inv.base, ...inv.subs].join(" ");
}
/** The recency key: the app and the non-localized path ("300/character browse") — two apps
 * exposing the same command name must not bump each other's recency. */
export function invocationKey(command: Command, inv: CommandInvocation): string {
	const path = inv.branch ? command.name + " " + inv.branch : command.name;
	return command.applicationId + "/" + path;
}
/** Substring-ratio match on the full label — Command.similar's intent (its own math has an
 * upstream constant-branch quirk in the case-insensitive path; this one stays proportional). */
export function similarLabel(label: string, search: string): number {
	if (!search.length) return 0.1;
	if (label.includes(search)) return search.length / label.length;
	if (label.toLowerCase().includes(search.toLowerCase()))
		return search.length / label.length / 1.4;
	return 0;
}

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

/** One app's slice of the picker: its index row and its pickable invocations. */
type Group = {
	app: applicationJson | undefined;
	name: string;
	invocations: {command: Command; inv: CommandInvocation}[];
};

/** Every pickable row of the command list, keyed for recency. */
type Entry = {command: Command; inv: CommandInvocation; key: string};

function entriesOf(commands: Command[]): Entry[] {
	return commands.flatMap((command) =>
		command.invocations.map((inv) => ({
			command,
			inv,
			key: invocationKey(command, inv),
		})),
	);
}

export function renderCommandPanel(
	localuser: Localuser,
	box: HTMLDivElement,
	commands: Command[],
	apps: applicationJson[] | undefined,
) {
	const recency = getCommandRecency();
	// Frequently Used: the last five RUNS, whatever path they took. hasOwn: a command named
	// "constructor" must not read the Object prototype as a recency entry.
	const recent = entriesOf(commands)
		.filter((entry) => Object.hasOwn(recency, entry.key))
		.sort(
			(a, b) =>
				recency[b.key] - recency[a.key] ||
				invocationLabel(a.inv).localeCompare(invocationLabel(b.inv)),
		)
		.slice(0, 5);
	// One group per application, alphabetical by name; a command whose app has no row in the
	// index still groups (under an unknown name) so it never disappears from the picker.
	const byId = new Map<string, Group>();
	for (const command of commands) {
		const app = apps?.find((_) => _.id === command.applicationId);
		let group = byId.get(command.applicationId);
		if (!group) {
			group = {app, name: app?.name || "?", invocations: []};
			byId.set(command.applicationId, group);
		}
		group.invocations.push(
			...command.invocations.map((inv) => ({command, inv})),
		);
	}
	const groups = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
	for (const group of groups) {
		// Alphabetical by the full "/name sub" text — a base's subs stay adjacent because
		// the shared prefix sorts together, as Discord's list does.
		group.invocations.sort((a, b) =>
			invocationLabel(a.inv).localeCompare(invocationLabel(b.inv)),
		);
	}

	const panel = document.createElement("div");
	panel.classList.add("searchPanel");
	const rail = document.createElement("div");
	rail.classList.add("searchRail");
	const body = document.createElement("div");
	body.classList.add("searchBody");
	panel.append(rail, body);

	const pick = (command: Command, inv: CommandInvocation) => {
		bumpCommandRecency(invocationKey(command, inv));
		// The pick closes the popup — the composer is now a command, its branch (if the row
		// was a subcommand) already chosen.
		box.replaceChildren();
		localuser.channelfocus?.startCommand(command, inv.branch);
	};

	const row = (command: Command, inv: CommandInvocation) => {
		const group = byId.get(command.applicationId);
		const div = document.createElement("div");
		div.classList.add("commandRow");
		div.append(appIconElm(localuser, group?.app));
		const text = document.createElement("div");
		text.classList.add("commandRowText");
		const name = document.createElement("span");
		// The name span reads exactly "/name" or "/name sub" — commit-on-space matches on
		// that text. The base is bold; the sub path, dimmer.
		name.classList.add("commandRowName");
		const base = document.createElement("span");
		base.classList.add("commandRowBase");
		base.textContent = "/" + inv.base;
		name.append(base);
		if (inv.subs.length) {
			const subs = document.createElement("span");
			subs.classList.add("commandRowSubs");
			subs.textContent = " " + inv.subs.join(" ");
			name.append(subs);
		}
		const desc = document.createElement("span");
		desc.classList.add("commandRowDesc");
		desc.textContent = inv.description;
		text.append(name, desc);
		div.append(text);
		const appName = document.createElement("span");
		appName.classList.add("commandRowApp");
		appName.textContent = group?.name ?? "";
		div.append(appName);
		div.onclick = () => pick(command, inv);
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
					section(
						I18n.commands.frequentlyUsed(),
						recent.map((entry) => row(entry.command, entry.inv)),
					),
					...groups.map((group) =>
						section(
							group.name,
							group.invocations.map(({command, inv}) => row(command, inv)),
						),
					),
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
					section(
						I18n.commands.appCommands(),
						group.invocations.map(({command, inv}) => row(command, inv)),
					),
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
