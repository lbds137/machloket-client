import {Play as JasfPlay} from "./worklet/play.js";

export class Play {
	buffer: ArrayBuffer;
	worklet?: AudioWorkletNode;
	private workletReady: Promise<AudioWorkletNode>;
	audioContext: AudioContext;
	tracks: string[] = [];
	onload = () => {};
	static soundNamesPromise = fetch("/audio/sounds.jasf")
		.then((res) => res.arrayBuffer())
		.then((buffer) => [...JasfPlay.parseBin(buffer).audios.keys()])
		.catch(() => [] as string[]);
	constructor(buffer: ArrayBuffer) {
		this.buffer = buffer;
		this.tracks = [...JasfPlay.parseBin(buffer).audios.keys()];
		this.audioContext = new AudioContext();
		this.workletReady = this.audioContext.audioWorklet
			.addModule(new URL("./worklet/worklet.js", import.meta.url))
			.then(() => {
				const worklet = new AudioWorkletNode(this.audioContext, "audio");
				this.worklet = worklet;
				worklet.connect(this.audioContext.destination);

				const events = ["click", "keydown", "touchstart"] as const;
				const func = () => {
					void this.start();
					events.forEach((event) => document.removeEventListener(event, func));
				};
				events.forEach((event) => document.addEventListener(event, func));
				console.log(this.audioContext);

				void this.sendMessage({name: "bin", bin: buffer});

				void this.sendMessage({name: "getTracks"});
				worklet.port.onmessage = (message) => {
					const data = message.data as recvMessage;
					switch (data.name) {
						case "tracks":
							this.tracks = data.tracks;
							this.onload();
							console.log(this.tracks);
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
