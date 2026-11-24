import {Play as JasfPlay} from "./worklet/play.js";
// Bundled as its own file: a plain new URL("./worklet/worklet.js") shipped the raw TypeScript
// source inlined as a data: URL, which Chromium refused to load as a worklet module.
import workletUrl from "./worklet/worklet.ts?worker&url";

export class Play {
	buffer: ArrayBuffer;
	worklet?: AudioWorkletNode;
	private workletReady: Promise<AudioWorkletNode>;
	audioContext: AudioContext;
	tracks: string[] = [];
	onload = () => {};
	constructor(buffer: ArrayBuffer) {
		this.buffer = buffer;
		this.tracks = [...JasfPlay.parseBin(buffer).audios.keys()];
		this.audioContext = new AudioContext();
		this.workletReady = this.audioContext.audioWorklet.addModule(workletUrl).then(() => {
			const worklet = new AudioWorkletNode(this.audioContext, "audio");
			this.worklet = worklet;
			worklet.connect(this.audioContext.destination);

			const events = ["click", "keydown", "touchstart"] as const;
			const func = () => {
				void this.start();
				events.forEach((event) => document.removeEventListener(event, func));
			};
			events.forEach((event) => document.addEventListener(event, func));

			void this.sendMessage({name: "bin", bin: buffer});

			void this.sendMessage({name: "getTracks"});
			worklet.port.onmessage = (message) => {
				const data = message.data as recvMessage;
				switch (data.name) {
					case "tracks":
						this.tracks = data.tracks;
						this.onload();
				}
			};
			return worklet;
		});
	}
	private async start() {
		if (this.audioContext.state === "suspended") {
			await this.sendMessage({name: "clear"});
			await this.audioContext.resume();
		}
	}
	private async sendMessage(message: sendMessage) {
		const worklet = await this.workletReady;
		worklet.port.postMessage(message);
	}
	async play(soundName: string, volume: number) {
		volume /= 200;
		await this.start();
		await this.sendMessage({name: "start", data: {name: soundName, volume}});
	}
	static async playURL(url: string) {
		const res = await fetch(url);
		const arr = await res.arrayBuffer();
		return new Play(arr);
	}
}
