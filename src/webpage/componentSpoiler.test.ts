import {beforeEach, describe, expect, it} from "vitest";
import type {component, UnfurledMediaItem} from "./jsontypes";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {dmMessage} = await import("./test/interactionFixture");
const {Components} = await import("./interactions/compontents");
const {MessageComponentType} = await import("./jsontypes");

// The container test hit-tests real layout, so the real stylesheet must be live
// (same pattern as typingPlacement / darkThemeContrast).
// @ts-expect-error Vite's ?inline import returns the stylesheet text.
const {default: style} = await import("./public/style.css?inline");
document.head.insertAdjacentHTML("beforeend", `<style>${style}</style>`);

const media: UnfurledMediaItem = {
	id: "media-1",
	url: "https://cdn.example/image.png",
	content_type: "image/png",
	width: 120,
	height: 80,
};

function renderComponent(comp: component): HTMLElement {
	const {channel, message} = dmMessage();
	(channel.info as {cdn?: string}).cdn = "http://dm.test/cdn";
	const [built] = new Components([comp], message).components;
	return built.getHTML();
}

// The spoiler cover's render reads the live userPreferences localStorage (utils/
// sensitiveContent.ts getSensitiveContentSync): sibling specs (settings-content-controls)
// persist spoilerAction "show"/"block" into the shared profile, which silently removed the
// cover here (2 gate sightings 10-27). Pin the app default instead of inheriting residue;
// tests that exercise other actions set their own action inside their bodies.
beforeEach(() => {
	localStorage.setItem("userPreferences", JSON.stringify({spoilerAction: "blur"}));
});

describe("component spoilers", () => {
	it("mediaGallery item with spoiler: true renders .fSpoil; without it does not", () => {
		const spoiled = renderComponent({
			type: MessageComponentType.MediaGallery,
			items: [{media, spoiler: true}],
		});
		const plain = renderComponent({
			type: MessageComponentType.MediaGallery,
			items: [{media}],
		});

		expect(spoiled.querySelector(".fSpoil")).not.toBeNull();
		expect(plain.querySelector(".fSpoil")).toBeNull();
	});

	it("thumbnail with spoiler: true renders .fSpoil; without it does not", () => {
		const spoiled = renderComponent({
			type: MessageComponentType.Thumbnail,
			media,
			spoiler: true,
		});
		const plain = renderComponent({
			type: MessageComponentType.Thumbnail,
			media,
		});

		expect(spoiled.querySelector(".fSpoil")).not.toBeNull();
		expect(plain.querySelector(".fSpoil")).toBeNull();
	});

	it("container with spoiler: true has componentSpoiler, clicking removes it, and without it is absent", () => {
		const spoiled = renderComponent({
			type: MessageComponentType.Container,
			spoiler: true,
			components: [{type: MessageComponentType.TextDisplay, content: "hidden text"}],
		});
		const plain = renderComponent({
			type: MessageComponentType.Container,
			components: [{type: MessageComponentType.TextDisplay, content: "visible text"}],
		});

		expect(spoiled.classList.contains("componentSpoiler")).toBe(true);
		document.body.append(spoiled, plain);
		// While spoiled, a real tap must land on the container (which reveals), not on
		// the hidden child. Hit-tested with elementFromPoint: synthetic .click() aims
		// straight at the child and would bypass the pointer-events rule under test.
		const child = document.createElement("button");
		spoiled.append(child);
		child.scrollIntoView();
		const rect = child.getBoundingClientRect();
		const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
		expect(hit).toBe(spoiled);
		// pointer-events stops taps; inert stops Tab/Enter on the hidden controls.
		const hidden = spoiled.firstElementChild as HTMLElement;
		expect(hidden.inert).toBe(true);
		spoiled.click();
		expect(spoiled.classList.contains("componentSpoiler")).toBe(false);
		expect(hidden.inert).toBe(false);
		expect(plain.classList.contains("componentSpoiler")).toBe(false);
		spoiled.remove();
		plain.remove();
	});

	// The sensitive-content setting (utils/sensitiveContent.ts) governs every spoiler path:
	// show renders the media raw, block replaces it with a placeholder, blur is today's cover.
	it("mediaGallery spoiler: show drops the cover, block replaces the media", () => {
		localStorage.setItem("userPreferences", JSON.stringify({spoilerAction: "show"}));
		const shown = renderComponent({
			type: MessageComponentType.MediaGallery,
			items: [{media, spoiler: true}],
		});
		expect(shown.querySelector(".fSpoil")).toBeNull();
		expect(shown.querySelector("img")).not.toBeNull();

		localStorage.setItem("userPreferences", JSON.stringify({spoilerAction: "block"}));
		const blocked = renderComponent({
			type: MessageComponentType.MediaGallery,
			items: [{media, spoiler: true}],
		});
		expect(blocked.querySelector(".fSpoilBlocked")).not.toBeNull();
		expect(blocked.querySelector("img")).toBeNull();
	});

	it("container spoiler: show renders the content with no cover", () => {
		localStorage.setItem("userPreferences", JSON.stringify({spoilerAction: "show"}));
		const shown = renderComponent({
			type: MessageComponentType.Container,
			spoiler: true,
			components: [{type: MessageComponentType.TextDisplay, content: "visible now"}],
		});
		expect(shown.classList.contains("componentSpoiler")).toBe(false);
	});

	it("container spoiler: block replaces the content with a placeholder", () => {
		localStorage.setItem("userPreferences", JSON.stringify({spoilerAction: "block"}));
		const blocked = renderComponent({
			type: MessageComponentType.Container,
			spoiler: true,
			components: [{type: MessageComponentType.TextDisplay, content: "never rendered"}],
		});
		expect(blocked.querySelector(".fSpoilBlocked")).not.toBeNull();
		expect(blocked.textContent).not.toContain("never rendered");
	});
});
