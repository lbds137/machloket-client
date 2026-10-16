import {expect, it, onTestFinished} from "vitest";

await import("./localuser");

const css = await (await fetch(new URL("./public/style.css", import.meta.url))).text();
document.head.insertAdjacentHTML("beforeend", `<style>${css}</style>`);

function mountHeader() {
	document.body.insertAdjacentHTML(
		"beforeend",
		`<div class="flexltr header channelnamediv">
			<label for="maintoggle" id="maintoggleicon">
				<span class="svgicon svg-category"></span>
			</label>
			<input type="checkbox" id="maintoggle" />
			<span class="flexltr" id="channelTitle" style="align-items: center">
				<span id="channelname">Channel name</span>
				<span id="channelTopic" class="ellipsis" hidden>Channel topic</span>
			</span>
			<div class="spaceElm"></div>
			<div id="pinnedMDiv">
				<span class="svgicon svg-pin" id="pinnedM"></span>
			</div>
			<div class="searchMeta">
				<div contenteditable="true" class="searchBox" id="searchBox"></div>
				<span id="searchX" class="svgicon svg-search" contenteditable="false"></span>
			</div>
			<div id="inboxMDiv">
				<span class="svgicon svg-inbox" id="inboxM"></span>
				<span id="inboxCount" hidden></span>
			</div>
			<label for="memberlisttoggle" id="memberlisttoggleicon">
				<span class="svgicon svg-friends"></span>
			</label>
			<span class="svgicon svg-update" i18n="updateAv" id="updateIcon" hidden></span>
			<input type="checkbox" id="memberlisttoggle" checked />
		</div>`,
	);
	onTestFinished(() => document.querySelector(".header")?.remove());
}

it("the header's icon gaps match on both sides of the search icon", () => {
	mountHeader();
	const rect = (id: string) => document.getElementById(id)!.getBoundingClientRect();
	const pin = rect("pinnedM");
	const search = rect("searchX");
	const inbox = rect("inboxM");
	const gapBeforeSearch = search.left - pin.right;
	const gapAfterSearch = inbox.left - search.right;

	// The magnifier must sit at the same distance from the pin as from the inbox: in the
	// closed header the empty search box's reserved space used to pile onto the pin side.
	expect(gapBeforeSearch).toBeGreaterThan(0);
	expect(Math.abs(gapBeforeSearch - gapAfterSearch)).toBeLessThanOrEqual(1);
});
