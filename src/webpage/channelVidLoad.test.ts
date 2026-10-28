import {describe, expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {Channel} = await import("./channel");
const {I18n} = await import("./i18n");
await I18n.done;

// A tile whose video is still negotiating (paused, no frame data yet) — the state a fresh
// WebRTC <video> sits in until the first frame decodes.
function notProgressing() {
	return document.createElement("video");
}

// A tile whose video already renders frames (remote track re-attached after a view rebuild).
function progressing() {
	const video = document.createElement("video");
	Object.defineProperty(video, "paused", {value: false});
	Object.defineProperty(video, "readyState", {value: HTMLMediaElement.HAVE_CURRENT_DATA});
	return video;
}

function vidChannel() {
	const channel = Object.create(Channel.prototype) as InstanceType<typeof Channel>;
	channel.boxMap = new Map();
	return channel;
}

function boxFor(channel: InstanceType<typeof Channel>, id: string) {
	const box = document.createElement("div");
	channel.boxMap.set(id, box);
	return box;
}

describe("the video tile loading state", () => {
	// RED: at HEAD boxVid appends the video bare, so no .vidloading ever appears.
	it("a video that is not progressing yet gets a loading overlay", () => {
		const channel = vidChannel();
		const box = boxFor(channel, "u1");

		channel.boxVid("u1", notProgressing());

		expect(box.querySelector("video")).not.toBeNull();
		expect(box.querySelector(".vidloading")).not.toBeNull();
	});

	// PIN: passes at HEAD; an already-rendering video (re-attach after a view rebuild)
	// must not flash a loader.
	it("a video that is already progressing gets no loading overlay", () => {
		const channel = vidChannel();
		const box = boxFor(channel, "u1");

		channel.boxVid("u1", progressing());

		expect(box.querySelector(".vidloading")).toBeNull();
	});

	// RED: at HEAD there is no overlay to remove, so the existence assert fails first.
	it("the overlay clears once the video starts playing", () => {
		const channel = vidChannel();
		const box = boxFor(channel, "u1");
		const video = notProgressing();

		channel.boxVid("u1", video);
		expect(box.querySelector(".vidloading")).not.toBeNull();

		video.dispatchEvent(new Event("playing"));

		expect(box.querySelector(".vidloading")).toBeNull();
	});

	// PIN: trivially green at HEAD (no overlay exists there); with the feature in, it pins
	// that purgeVid strips the overlay too — a video switched off mid-load must not leave
	// a loader spinning on an empty tile forever.
	it("turning the video off removes the overlay with it", () => {
		const channel = vidChannel();
		const box = boxFor(channel, "u1");

		channel.boxVid("u1", notProgressing());
		channel.purgeVid("u1");

		expect(box.querySelector("video")).toBeNull();
		expect(box.querySelector(".vidloading")).toBeNull();
	});

	// PIN: boxChange re-calls boxVid on every user-state change (mute/deaf) while video is
	// on; a second call must not stack a second overlay.
	it("a repeated boxVid while still loading keeps one overlay", () => {
		const channel = vidChannel();
		const box = boxFor(channel, "u1");
		const video = notProgressing();

		channel.boxVid("u1", video);
		channel.boxVid("u1", video);

		expect(box.querySelectorAll(".vidloading")).toHaveLength(1);
	});

	// RED: at HEAD the dedupe short-circuits on the existing overlay, so the listener stays
	// armed on the FIRST element only — renegotiation's replacement element plays and the
	// loader never clears (a permanent spinner over a working video).
	it("a replacement element arriving mid-load re-arms the overlay on itself", () => {
		const channel = vidChannel();
		const box = boxFor(channel, "u1");
		const first = notProgressing();
		const second = notProgressing();

		channel.boxVid("u1", first);
		channel.boxVid("u1", second);
		expect(box.querySelectorAll(".vidloading")).toHaveLength(1);

		second.dispatchEvent(new Event("playing"));

		expect(box.querySelector(".vidloading")).toBeNull();
	});

	// PIN: passes at HEAD; a video that reaches HAVE_CURRENT_DATA without a playing event
	// (the fast-path branch) clears the stale overlay on the next boxChange.
	it("a video already rendering clears a stale overlay on re-attach", () => {
		const channel = vidChannel();
		const box = boxFor(channel, "u1");
		const video = notProgressing();

		channel.boxVid("u1", video);
		expect(box.querySelector(".vidloading")).not.toBeNull();

		Object.defineProperty(video, "paused", {value: false});
		Object.defineProperty(video, "readyState", {value: HTMLMediaElement.HAVE_CURRENT_DATA});
		channel.boxVid("u1", video);

		expect(box.querySelector(".vidloading")).toBeNull();
	});

	// RED: at HEAD the overlay is three bare spans — screen readers hear nothing.
	it("the overlay announces itself to screen readers", () => {
		const channel = vidChannel();
		const box = boxFor(channel, "u1");

		channel.boxVid("u1", notProgressing());

		const loading = box.querySelector(".vidloading");
		expect(loading?.getAttribute("role")).toEqual("status");
		expect(loading?.getAttribute("aria-label")).toEqual(I18n.vc.videoLoading());
	});
});
