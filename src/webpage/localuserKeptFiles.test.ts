import {expect, it} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {Channel} = await import("./channel");

/** A session holding the given channels, by id, each with its waiting files. */
function session(channels: Record<string, Blob[]>) {
	const user = Object.create(Localuser.prototype) as InstanceType<typeof Localuser>;
	const lists = new Map<string, [Blob[], WeakMap<Blob, HTMLElement>]>();
	const channelids = new Map<string, unknown>();
	for (const [id, files] of Object.entries(channels)) {
		const htmls = new WeakMap(files.map((file) => [file, document.createElement("div")]));
		lists.set(id, [files, htmls]);
		channelids.set(id, {files, htmls});
	}
	Object.assign(user, {channelids, keptFiles: new Map()});
	return {user, lists};
}

it("keeps the waiting files of every channel, open or not, as the lists themselves", () => {
	const {user, lists} = session({
		"1": [new Blob(["open"])],
		"2": [new Blob(["saved in another channel"]), new Blob(["and a second"])],
	});

	user.keepWaitingFiles();

	for (const id of ["1", "2"]) {
		const [files, htmls] = user.takeKeptFiles(id)!;
		// The same list and map, so each thumbnail's controls still act on what sends.
		expect(files).toBe(lists.get(id)![0]);
		expect(htmls).toBe(lists.get(id)![1]);
	}
});

it("keeps nothing for a channel with no waiting files", () => {
	const {user} = session({"1": []});

	user.keepWaitingFiles();

	expect(user.takeKeptFiles("1")).toBeUndefined();
});

it("hands back a list emptied after it was kept as empty: a sent or cleared file stays gone", () => {
	const {user} = session({"1": [new Blob(["sent while the reconnect was under way"])]});
	user.keepWaitingFiles();
	const [files] = user.takeKeptFiles("1")!;
	// A send and Escape both empty the list in place.
	files.length = 0;
	Object.assign(user, {channelids: new Map([["1", {files, htmls: new WeakMap()}]])});

	user.keepWaitingFiles();

	expect(user.takeKeptFiles("1")).toBeUndefined();
});

it("hands each channel's files over once", () => {
	const {user} = session({"1": [new Blob(["x"])]});
	user.keepWaitingFiles();

	expect(user.takeKeptFiles("1")).toBeDefined();
	expect(user.takeKeptFiles("1")).toBeUndefined();
});

it("still holds files for a channel the rebuild left out (a thread built later) at the next rebuild", () => {
	const {user, lists} = session({"9": [new Blob(["in a thread built only when opened"])]});
	user.keepWaitingFiles();
	// The next rebuild sees only the channels this session built.
	Object.assign(user, {channelids: new Map()});

	user.keepWaitingFiles();

	expect(user.takeKeptFiles("9")?.[0]).toBe(lists.get("9")![0]);
});

/** A channel owner whose session hands back `kept` for its id, as a rebuild would. */
function ownerKeeping(id: string, kept: [Blob[], WeakMap<Blob, HTMLElement>]) {
	const keptFiles = new Map([[id, kept]]);
	const localuser = Object.assign(Object.create(Localuser.prototype), {
		keptFiles,
		idToNext: new Map(),
		idToPrev: new Map(),
		messages: new Map(),
		channelids: new Map(),
	});
	return {localuser, headers: {}} as unknown as ConstructorParameters<typeof Channel>[1];
}

it("gives a DM or group DM its files back, which build through the -1 path with their own id", () => {
	const files = [new Blob(["photo"])];
	const htmls = new WeakMap([[files[0], document.createElement("div")]]);

	const dm = new Channel(-1, ownerKeeping("300", [files, htmls]), "300");

	expect(dm.files).toBe(files);
	expect(dm.htmls).toBe(htmls);
});

it("gives nothing to the -1 path's placeholder with no id", () => {
	const files = [new Blob(["x"])];
	const owner = ownerKeeping("", [files, new WeakMap()]);

	const placeholder = new Channel(-1, owner);

	expect(placeholder.files).toEqual([]);
});
