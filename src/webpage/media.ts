import {Contextmenu} from "./contextmenu.js";
import {I18n} from "./i18n.js";
import {Dialog} from "./settings.js";
import {ProgressiveArray} from "./utils/progessiveLoad.js";
import {attachmentUrl} from "./utils/netUtils.js";

/** The largest ID3 frame this parser will decompress. IdentifyFile runs on every audio
 * attachment that renders — chat-reachable input — and zlib ratios reach ~1000:1, so an
 * unbounded inflate would let one posted file eat a viewer's tab. Covers any sane cover art. */
const MAX_INFLATED_FRAME = 8 * 1024 * 1024;
/** The only frame ids anything downstream reads (both versions' text maps, the year/
 * timestamp/length frames, and the pictures). Compressed frames with any other id are
 * consumed but never inflated: a tag of distinct-id 8 MiB bombs must not spend the
 * decompression budget frame by frame. */
const READ_FRAME_IDS = new Set([
	"PIC",
	"TYE",
	"TT2",
	"TP1",
	"TCM",
	"TAL",
	"TCO",
	"TEN",
	"APIC",
	"TYER",
	"TDRC",
	"TLEN",
	"TIT2",
	"TPE1",
	"TCOM",
	"TALB",
	"TMED",
	"TENC",
]);
/** A track's length (`ms`) for the More info dialog. */
function lengthText(ms: number) {
	// Rounded as a whole first, so 59.6 s reads as a minute rather than "0 minutes and 60 seconds".
	const total = Math.round(ms / 1000);
	return I18n.media.length(Math.floor(total / 60) + "", (total % 60) + "");
}
const menu = new Contextmenu<media, undefined>("media");
menu.addButton(
	() => I18n.media.download(),
	function () {
		const src = attachmentUrl(this.src);
		if (!src) return;
		const a = document.createElement("a");
		a.href = src;
		a.download = this.filename;
		a.click();
	},
);
menu.addButton(
	() => I18n.media.moreInfo(),
	async function () {
		const di = new Dialog(this.title);
		const options = di.float.options;
		if (this.img) {
			const img = document.createElement("img");
			img.classList.add("media-medium");
			img.src = this.img.url;
			if (this.img.description) img.alt = this.img.description;
			options.addHTMLArea(img);
		}
		if (this.artist) {
			options.addText(I18n.media.artist(this.artist));
		}
		if (this.composer) {
			options.addText(I18n.media.composer(this.composer));
		}
		const length = await this.length;
		if (Number.isFinite(length)) options.addText(lengthText(length));

		di.show();
		if (this.copyright) {
			const text = options.addText(this.copyright);
			const txt = text.elm.deref();
			if (txt) {
				txt.classList.add("timestamp");
			}
		}
	},
);
type mediaEvents =
	| {
			type: "play";
	  }
	| {
			type: "pause";
	  }
	| {
			type: "playing";
			time: number;
	  }
	| {
			type: "done";
	  }
	| {
			type: "audio";
			t: "start" | "stop";
	  }
	| {
			type: "audio";
			t: "skip";
			time: number;
	  }
	| {
			type: "end";
	  };

function makePlayBox(
	mor: string | media,
	player: MediaPlayer,
	ctime = 0,
	url: Promise<string> | void,
) {
	const div = document.createElement("div");
	div.classList.add("flexltr", "Mplayer");

	const button = document.createElement("img");
	button.classList.add("svg-mediaButton", "svg-play");

	const vDiv = document.createElement("div");
	vDiv.classList.add("flexttb");

	const title = document.createElement("span");
	title.textContent = I18n.media.loading();

	const barDiv = document.createElement("div");
	barDiv.classList.add("flexltr");

	const bar = document.createElement("input");
	bar.type = "range";
	bar.disabled = true;
	bar.value = "" + ctime;
	bar.min = "0";

	const time = document.createElement("span");
	time.textContent = "0:00/..:..";

	const more = document.createElement("span");
	more.classList.add("svg-soundMore", "svg-mediaSettings");

	barDiv.append(bar, time);
	vDiv.append(title, barDiv);
	div.append(button, vDiv, more);
	(async () => {
		if (url) mor = await url;
		MediaPlayer.IdentifyFile(mor).then((thing) => {
			let audio: HTMLAudioElement | undefined = undefined;
			// The element before its data has loaded (`audio` is only set on loadeddata).
			let loading: HTMLAudioElement | undefined = undefined;

			if (!thing) {
				// The player's own title said "Loading..." until now.
				title.textContent = I18n.media.notFound();
				return;
			}
			menu.bindContextmenu(
				more,
				thing,
				undefined,
				() => {},
				() => {},
				"left",
			);
			player.addListener(thing.src, followUpdates, div);
			let int: ReturnType<typeof setInterval> | undefined;
			if (typeof mor !== "string") {
				const cmor = mor;
				const audioo = new Audio(cmor.src);
				loading = audioo;
				audioo.load();
				audioo.autoplay = true;
				audioo.currentTime = ctime / 1000;
				int = setInterval(() => {
					if (!document.contains(div)) {
						// The box was re-rendered or removed mid-play: stop ticking (and playing).
						clearInterval(int);
						audioo.pause();
						return;
					}
					if (button.classList.contains("svg-pause")) {
						player.addUpdate(cmor.src, {type: "playing", time: audioo.currentTime * 1000});
					}
				}, 100);
				audioo.onplay = () => {
					player.addUpdate(cmor.src, {type: "play"});
				};
				audioo.onpause = () => {
					player.addUpdate(thing.src, {type: "pause"});
				};
				audioo.onloadeddata = () => {
					audio = audioo;
				};
				audioo.onended = () => {
					player.addUpdate(cmor.src, {type: "end"});
				};
			}
			button.onclick = () => {
				if (!player.isPlaying(thing.src)) {
					player.setToTopList(thing, +bar.value * 1000);
				} else {
					player.addUpdate(thing.src, {
						type: "audio",
						t: button.classList.contains("svg-play") ? "start" : "stop",
					});
				}
			};
			function followUpdates(cur: mediaEvents) {
				if (audio && cur.type !== "playing") {
				}
				if (cur.type == "audio" && audio) {
					if (cur.t == "start") {
						audio.play();
					} else if (cur.t == "stop") {
						audio.pause();
					} else if (cur.t == "skip" && audio) {
						audio.currentTime = cur.time / 1000;
					}
				}
				if (cur.type == "audio" && cur.t == "skip") {
					bar.value = "" + cur.time / 1000;
				}
				if (cur.type == "playing") {
					regenTime(cur.time);
					bar.value = "" + cur.time / 1000;
					button.classList.add("svg-pause");
					button.classList.remove("svg-play");
				} else if (cur.type === "play") {
					button.classList.add("svg-pause");
					button.classList.remove("svg-play");
				} else if (cur.type === "pause") {
					button.classList.add("svg-play");
					button.classList.remove("svg-pause");
				} else if (cur.type === "end") {
					clearInterval(int);
					if (audio) {
						audio.pause();
						audio.src = "";
						player.end();
					} else if (loading) {
						// Ended before it loaded: pause it, or it autoplays over the next track once loaded.
						loading.pause();
					}
					button.classList.add("svg-play");
					button.classList.remove("svg-pause");
					regenTime();
				}
			}

			const med = thing;
			if (med.img) {
				let img: HTMLImageElement;
				if (mor instanceof Object) {
					img = button;
				} else {
					img = document.createElement("img");
					div.append(img);
				}
				img.classList.add("media-small");
				img.src = med.img.url;
			}
			function timeToString(time: number) {
				const minutes = Math.floor(time / 1000 / 60);
				const seconds = Math.round(time / 1000 - minutes * 60) + "";
				return `${minutes}:${seconds.padStart(2, "0")}`;
			}
			bar.oninput = () => {
				player.addUpdate(thing.src, {
					type: "audio",
					t: "skip",
					time: +bar.value * 1000,
				});
				regenTime(+bar.value * 1000);
			};
			async function regenTime(curTime: number = 0) {
				const len = await med.length;
				if (!Number.isFinite(len)) {
					time.textContent = timeToString(curTime);
					return;
				}
				bar.disabled = false;
				bar.max = "" + len / 1000;

				time.textContent = `${timeToString(curTime)}/${timeToString(len)}`;
			}
			regenTime();
			title.textContent = thing.title;
		});
	})();
	return div;
}

/**
 * An ID3 text frame: its first byte names the encoding (0 Latin-1, 1 UTF-16 with a byte-order
 * mark, 2 UTF-16BE, 3 UTF-8), then the text, maybe NUL-terminated. Below v2.4 the text ends at
 * its first NUL; only v2.4 lets a frame hold several NUL-separated values.
 */
function decodeId3Text(frame: Uint8Array, version: number) {
	const [encoding] = frame;
	let bytes = frame.subarray(1);
	let label = ["latin1", "utf-16le", "utf-16be", "utf-8"][encoding] ?? "utf-8";
	if (encoding === 1 && bytes[0] === 0xfe && bytes[1] === 0xff) label = "utf-16be";
	if (encoding === 1 || encoding === 2) {
		if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
			bytes = bytes.subarray(2);
		}
	}
	const text = new TextDecoder(label).decode(bytes);
	if (version < 4) {
		// Before v2.4 the bytes after the first terminator are not a second value: drop them.
		return text.split("\0")[0];
	}
	// v2.4 text frames may hold several NUL-separated values; show them all.
	return text
		.split("\0")
		.filter((value) => value !== "")
		.join(" / ");
}
interface media {
	src: string;
	filename: string;
	img?: {
		url: string;
		description?: string;
	};
	title: string;
	artist?: string;
	composer?: string;
	sourcy?: string;
	year?: number;
	copyright?: string;
	length: number | Promise<number>;
}
class MediaPlayer {
	lists: media[] = [];
	curAudio?: HTMLElement;
	private listeners: [(e: mediaEvents) => void, string][] = [];
	elm: HTMLDivElement;
	cur = 0;
	constructor() {
		this.elm = document.getElementById("player") as HTMLDivElement;
	}
	addElmToList(audio: media) {
		this.lists.unshift(audio);
	}
	addUpdate(e: string, update: mediaEvents) {
		for (const thing of this.listeners) {
			if (thing[1] === e) {
				thing[0](update);
			}
		}
	}
	addListener(audio: string, updates: (e: mediaEvents) => void, elm: HTMLElement) {
		this.listeners.push([updates, audio]);
		const int = setInterval(() => {
			if (!document.contains(elm)) {
				clearInterval(int);
				this.listeners = this.listeners.filter((_) => _[0] !== updates);
			}
		}, 1000);
	}
	isPlaying(str: string) {
		const med = this.lists[this.cur];
		if (!med) return false;
		return med.src === str;
	}
	setToTopList(audio: media, time: number) {
		const med = this.lists[this.cur];
		if (med) {
			this.addUpdate(med.src, {type: "end"});
		}
		this.lists.splice(this.cur, 0, audio);
		this.regenPlayer(time);
	}
	end() {
		if (this.curAudio) {
			this.curAudio.remove();
			this.cur++;
			this.regenPlayer(0);
		}
	}
	regenPlayer(time: number) {
		this.elm.innerHTML = "";
		if (this.lists.length > this.cur) {
			const audio = this.lists[this.cur];
			this.elm.append((this.curAudio = makePlayBox(audio, this, time)));
		}
	}
	static cache = new Map<string, media | Promise<media | null>>();
	static async IdentifyFile(url: string | media): Promise<media | null> {
		if (url instanceof Object) {
			return url;
		}
		const cValue = this.cache.get(url);
		if (cValue) {
			return cValue;
		}
		let resMedio = (_: media | null) => {};
		this.cache.set(url, new Promise<media | null>((res) => (resMedio = res)));
		const prog = new ProgressiveArray(url, {method: "get"});
		try {
			await prog.ready;
		} catch (e) {
			// A failed load (an expired link, a dropped connection) isn't remembered: the next
			// render asks again, and everyone waiting on this one hears "not found".
			console.error(e);
			this.cache.delete(url);
			resMedio(null);
			return null;
		}

		const output: Partial<media> = {
			src: url,
		};
		try {
			const head = String.fromCharCode(await prog.next(), await prog.next(), await prog.next());
			if (head === "ID3") {
				// Major version, then a revision byte that never changes the layout (2.4.1 reads like 2.4.0).
				const version = await prog.next();
				await prog.next();

				if (version === 2) {
					//TODO I'm like 90% I can ignore *all* of the flags, but I need to check more sometime
					await prog.next();
					const sizes = await prog.get8BitArray(4);
					prog.sizeLeft = (sizes[0] << 21) + (sizes[1] << 14) + (sizes[2] << 7) + sizes[3];
					const mappy = new Map<string, Uint8Array<ArrayBuffer>>();
					while (prog.sizeLeft > 0) {
						const Identify = String.fromCharCode(
							await prog.next(),
							await prog.next(),
							await prog.next(),
						);
						const sizeArr = await prog.get8BitArray(3);
						const size = (sizeArr[0] << 16) + (sizeArr[1] << 8) + sizeArr[2];
						if (Identify === String.fromCharCode(0, 0, 0)) {
							break;
						}
						if (!size) {
							throw Error("weirdness");
						}
						if (!Identify.match(/[A-Z0-9]/gm)) {
							console.error(`tried to get ${Identify} which doesn't exist`);
							break;
						}
						if (mappy.has(Identify)) {
							await prog.get8BitArray(size);
						} else {
							mappy.set(Identify, await prog.get8BitArray(size));
						}
					}
					const pic = mappy.get("PIC");
					if (pic) {
						let i = 5; //skipping info I don't need right now
						const desc: number[] = [];
						for (; pic[i]; i++) {
							desc.push(pic[i]);
						}
						const description = new TextDecoder().decode(new Uint8Array(desc));
						i++;
						const blob = new Blob([pic.slice(i, pic.length).buffer], {type: "image/jpeg"});
						const urlmaker = window.URL || window.webkitURL;
						const url = urlmaker.createObjectURL(blob);
						output.img = {url, description};
					}
					const mapmap = {
						// Keep these keys in READ_FRAME_IDS (top of file): a compressed frame with
						// an id outside that set is never inflated, so a new key here is silently
						// unreadable in compressed tags until the set grows too.
						TT2: "title",
						TP1: "artist",
						TCM: "composer",
						TAL: "sourcy",
						TCO: "type",
						TEN: "copyright",
					} as const;
					for (const [key, ind] of Object.entries(mapmap)) {
						const temp = mappy.get(key);
						if (temp) {
							//@ts-ignore TS is being weird about this idk why
							output[ind] = decodeId3Text(temp, version);
						}
					}
					const tye = mappy.get("TYE");
					if (tye) {
						output.year = +decodeId3Text(tye, version);
					}
					//TODO more thoroughly check if these two are the same format
				} else if (version === 3 || version === 4) {
					const flags = await prog.next();
					if (flags & 0b01000000) {
						//TODO deal with the extended header
					}
					const sizes = await prog.get8BitArray(4);
					prog.sizeLeft = (sizes[0] << 21) + (sizes[1] << 14) + (sizes[2] << 7) + sizes[3];
					const mappy = new Map<string, Uint8Array<ArrayBuffer>>();
					// The decompression budget is per TAG, not per frame: the 18 whitelisted ids
					// × 8 MiB each would otherwise be ~144 MiB of honest-looking frames.
					let inflateBudget = MAX_INFLATED_FRAME;
					while (prog.sizeLeft > 0) {
						const Identify = String.fromCharCode(
							await prog.next(),
							await prog.next(),
							await prog.next(),
							await prog.next(),
						);
						const sizeArr = await prog.get8BitArray(4);
						// v2.4 frame sizes are synchsafe (7 bits a byte) like the tag's; v2.3's are plain,
						// and unsigned (a "<< 24" would go negative).
						const size =
							version === 4
								? (sizeArr[0] << 21) + (sizeArr[1] << 14) + (sizeArr[2] << 7) + sizeArr[3]
								: sizeArr[0] * 2 ** 24 + (sizeArr[1] << 16) + (sizeArr[2] << 8) + sizeArr[3];
						if (size > prog.sizeLeft) {
							// Truncated: the frame claims more bytes than the tag has left. Bounding
							// this here bounds every consume path below (store, dup, skip, inflate).
							break;
						}

						const flags = await prog.get8BitArray(2);
						const compression = !!(flags[1] & 0b10000000);
						if (compression) {
							// Frame-level compression (v2.3 layout): a plain 4-byte decompressed
							// size, then zlib data ("deflate" is the RFC 1950 zlib container the
							// ID3 spec cites). A grouped or encrypted frame carries an extra byte
							// before the data; streams that overshoot their declared size are
							// abandoned mid-read — a chat-posted file must not allocate GBs.
							// (v2.4's flag bit and Data Length Indicator differ — see the
							// tracker's v2.4-flags row.)
							const extra =
								(flags[1] & 0b01000000 ? 1 : 0) + (flags[1] & 0b00100000 ? 1 : 0);
							if (size < 4 + extra) {
								// Malformed: the frame cannot hold its own declared size.
								break;
							}
							const sizeArr2 = await prog.get8BitArray(4);
							const declared =
								version === 4
									? (sizeArr2[0] << 21) +
										(sizeArr2[1] << 14) +
										(sizeArr2[2] << 7) +
										sizeArr2[3]
									: sizeArr2[0] * 2 ** 24 +
										(sizeArr2[1] << 16) +
										(sizeArr2[2] << 8) +
										sizeArr2[3];
							if (extra) {
								await prog.get8BitArray(extra);
							}
							const packed = await prog.get8BitArray(size - 4 - extra);
							// Encrypted post-compression: undecryptable here, so never stored.
							if (flags[1] & 0b01000000) {
								continue;
							}
							// A declared size past the frame cap is a bomb by header; a declaration
							// past the tag's remaining budget is the same bomb spread across frames.
							if (declared > MAX_INFLATED_FRAME || declared > inflateBudget) {
								continue;
							}
							// Only ids something downstream reads ever inflate; everything else was
							// consumed above and skipped, so distinct-id bombs spend nothing.
							if (READ_FRAME_IDS.has(Identify) && !mappy.has(Identify)) {
								// Feed the decompressor in small slices: implementations inflate a
								// whole input chunk per transform() call and enqueue eagerly, so one
								// big stream would allocate the full output before this reader's cap
								// could fire. Sliced, a transform's output stays ~slice × zlib ratio.
								const SLICE = 4096;
								let at = 0;
								const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
									pull(controller) {
										if (at >= packed.length) {
											controller.close();
											return;
										}
										const end = Math.min(at + SLICE, packed.length);
										controller.enqueue(packed.subarray(at, end));
										at = end;
									},
								});
								try {
									const reader = source
										.pipeThrough(new DecompressionStream("deflate"))
										.getReader();
									const chunks: Uint8Array[] = [];
									let total = 0;
									for (;;) {
										const {done, value} = await reader.read();
										if (done) break;
										total += value.length;
										if (total > declared) {
											// The header lied: abandon the stream mid-read.
											await reader.cancel();
											total = -1;
											break;
										}
										chunks.push(value);
									}
									if (total >= 0) {
										const body = new Uint8Array(total);
										let offset = 0;
										for (const chunk of chunks) {
											body.set(chunk, offset);
											offset += chunk.length;
										}
										mappy.set(Identify, body);
										inflateBudget -= declared;
									}
								} catch {
									// A corrupt or padded stream loses this frame, not the whole tag.
								}
							}
							continue;
						}
						const encyption = !!(flags[1] & 0b01000000);
						if (encyption) {
							// Not supported: consume the frame so the loop stays aligned.
							await prog.get8BitArray(size);
							continue;
						}

						if (Identify === String.fromCharCode(0, 0, 0, 0)) {
							break;
						}
						if (!size) {
							//throw Error("weirdness");
						}
						if (!Identify.match(/[A-Z0-9]/gm)) {
							console.error(`tried to get ${Identify} which doesn't exist`);
							break;
						}
						if (mappy.has(Identify)) {
							await prog.get8BitArray(size);
						} else {
							mappy.set(Identify, await prog.get8BitArray(size));
						}
					}
					const pic = mappy.get("APIC");
					if (pic) {
						//const encoding = pic[0];
						let i = 1; //skipping info I don't need right now
						for (; pic[i]; i++) {}
						i += 2;
						let desc: number[] = [];
						for (; pic[i]; i++) {
							desc.push(pic[i]);
						}
						const description = new TextDecoder().decode(new Uint8Array(desc));
						i++;
						const blob = new Blob([pic.slice(i, pic.length).buffer], {type: "image/jpeg"});
						const urlmaker = window.URL || window.webkitURL;
						const url = urlmaker.createObjectURL(blob);
						output.img = {url, description};
					}
					const mapmap = {
						// Keep these keys in READ_FRAME_IDS (top of file): a compressed frame with
						// an id outside that set is never inflated, so a new key here is silently
						// unreadable in compressed tags until the set grows too.
						TIT2: "title",
						TPE1: "artist",
						TCOM: "composer",
						TALB: "sourcy",
						TMED: "type",
						TENC: "copyright",
					} as const;
					for (const [key, ind] of Object.entries(mapmap)) {
						const temp = mappy.get(key);
						if (temp) {
							//@ts-ignore TS is being weird about this idk why
							output[ind] = decodeId3Text(temp, version);
						}
					}
					const TYER = mappy.get("TYER");
					if (TYER) {
						output.year = +decodeId3Text(TYER, version);
					}
					// v2.4 retired TYER for TDRC (an ISO-ish recording time); its first four
					// digits are the year.
					const TDRC = mappy.get("TDRC");
					if (!output.year && TDRC) {
						output.year = +decodeId3Text(TDRC, version).slice(0, 4);
					}
					const TLEN = mappy.get("TLEN");
					if (TLEN) {
						output.length = +decodeId3Text(TLEN, version);
					}
				}
			} //TODO implement more metadata types
		} catch (e) {
			console.error(e);
		} finally {
			output.filename = new URL(url).pathname.split("/").at(-1);
			prog.close();
			if (!output.length) {
				output.length = new Promise<number>(async (res) => {
					const audio = document.createElement("audio");
					audio.src = url;
					audio.onloadedmetadata = (_) => {
						output.length = audio.duration * 1000;
						res(audio.duration * 1000);
					};
					// A file the browser can't decode has no length: NaN, which the player and
					// "More info" show as unknown instead of waiting forever.
					audio.onerror = () => {
						output.length = NaN;
						res(NaN);
					};
					audio.load();
				});
			}
			if (!output.title) {
				output.title = output.filename;
			}
		}
		resMedio(output as media);
		return output as media;
	}
}
export {MediaPlayer, media, makePlayBox, lengthText};
