import {afterEach, expect, it} from "vitest";
import {page} from "vitest/browser";

await import("./localuser");

// @ts-expect-error Vite's ?inline import returns the stylesheet text.
const {default: style} = await import("./public/style.css?inline");
document.head.insertAdjacentHTML("beforeend", `<style>${style}</style>`);

afterEach(async () => {
	document.getElementById("chatArea")?.remove();
	await page.viewport(1280, 800);
});

/** The composer as app.html lays it out, with someone typing. */
function mountComposer(replying = false) {
	const reply = replying
		? `<div id="replybox"><span>Replying to TzurotBot</span><span class="cancelReply">✕</span></div>`
		: `<div id="replybox" class="hideReplyBox"></div>`;
	document.body.insertAdjacentHTML(
		"beforeend",
		`<div class="flexttb flexgrow" id="chatArea" style="height: 600px">
			<div id="channelw" class="flexltr" style="flex: 1"><div id="scrollWrap"></div></div>
			${reply}
			<div id="typediv">
				<div id="realbox">
					<div class="outerTypeBox noConent">
						<div id="typebox" contenteditable="true"></div>
					</div>
				</div>
				<div id="typing" class="flexltr">
					<p id="typingtext">TzurotBot is typing</p>
				</div>
			</div>
		</div>`,
	);
	return {
		reply: document.getElementById("replybox")!.getBoundingClientRect(),
		box: document.querySelector(".outerTypeBox")!.getBoundingClientRect(),
		typing: document.getElementById("typing")!.getBoundingClientRect(),
	};
}

it("on a phone, the typing line sits above the text box, as in Discord's app", async () => {
	await page.viewport(400, 800);
	const {box, typing} = mountComposer();

	expect(typing.bottom).toBeLessThanOrEqual(box.top);
});

it("on a phone, while replying, the typing line sits above the reply bar, not over it", async () => {
	await page.viewport(400, 800);
	const {reply, typing} = mountComposer(true);

	expect(reply.height).toBeGreaterThan(0);
	expect(typing.bottom).toBeLessThanOrEqual(reply.top);
});

// A guard on today's desktop placement (the line anchors to the page's bottom edge there).
it("on a wide screen it stays under the text box, as on Discord's desktop", async () => {
	const {box, typing} = mountComposer();

	expect(typing.top).toBeGreaterThanOrEqual(box.bottom);
});
