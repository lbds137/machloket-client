import {Play as JasfPlay} from "./worklet/play.js";

export class Play {
	buffer: ArrayBuffer;
	worklet!: AudioWorkletNode;
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
		this.audioContext.audioWorklet.addModule(new URL("./worklet/worklet.ts", import.meta.url).href).then((_) => {
			this.worklet = new AudioWorkletNode(this.audioContext, "audio");
			this.worklet.connect(this.audioContext.destination);

			const events = ["click", "keydown", "touchstart"] as const;
			const func = () => {
				this.start();
				events.forEach((event) => document.removeEventListener(event, func));
			};
			events.forEach((event) => document.addEventListener(event, func));
			console.log(this.audioContext);

			this.sendMessage({name: "bin", bin: buffer});

			this.sendMessage({name: "getTracks"});
			this.worklet.port.onmessage = (message) => {
				const data = message.data as recvMessage;
				switch (data.name) {
					case "tracks":
						this.tracks = data.tracks;
						this.onload();
						console.log(this.tracks);
				}
			};
		});
	}
	private async start() {
		if (this.audioContext.state === "suspended") {
			this.sendMessage({name: "clear"});
			await this.audioContext.resume();
		}
	}
	private sendMessage(message: sendMessage) {
		this.worklet.port.postMessage(message);
	}
	async play(soundName: string, volume: number) {
		volume /= 200;
		await this.start();
		this.sendMessage({name: "start", data: {name: soundName, volume}});
	}
	static async playURL(url: string) {
		const res = await fetch(url);
		const arr = await res.arrayBuffer();
		return new Play(arr);
	}
}
