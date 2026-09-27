import {I18n} from "../i18n.js";
import type {interactionEvents} from "../jsontypes.js";

// A slash command has no message of its own to show its progress on (buttons and selects use
// theirs, see Message.interactionEvents), so it shows above the composer: sending, then gone
// when the bot answers, or why it didn't. The server sends the invoker INTERACTION_FAILURE
// with reason TIMEOUT when the bot doesn't answer within 3 s.

const TIMEOUT = 2;
const clearTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * `onScreen`: the command's channel is the one showing. The composer is shared by every
 * channel, so the line remembers whose status it shows: an event for that command always
 * clears it once its channel is gone, or it would be stuck on the next channel.
 */
export function showCommandStatus(event: interactionEvents, onScreen: boolean) {
	const typediv = document.getElementById("typediv");
	if (!typediv) return;
	let line = typediv.querySelector<HTMLElement>(".commandStatus");
	if (!onScreen) {
		if (line?.dataset.nonce === event.d.nonce) clearLine(line);
		return;
	}
	if (!line) {
		line = document.createElement("div");
		line.classList.add("commandStatus");
		typediv.prepend(line);
	}
	line.dataset.nonce = event.d.nonce;
	clearTimeout(clearTimers.get(line));
	line.classList.remove("failed");
	switch (event.t) {
		case "INTERACTION_CREATE":
			line.textContent = I18n.interactions.started();
			break;
		case "INTERACTION_SUCCESS":
			line.textContent = "";
			break;
		case "INTERACTION_FAILURE": {
			line.textContent =
				event.d.reason_code === TIMEOUT
					? I18n.interactions.noResponse()
					: I18n.interactions.failed();
			line.classList.add("failed");
			const shown = line;
			clearTimers.set(
				line,
				setTimeout(() => clearLine(shown), 5000),
			);
			break;
		}
	}
}

function clearLine(line: HTMLElement) {
	clearTimeout(clearTimers.get(line));
	line.textContent = "";
	line.classList.remove("failed");
	delete line.dataset.nonce;
}
