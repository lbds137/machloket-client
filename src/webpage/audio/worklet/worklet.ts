import {mixAudio} from "./mixAudio.js";
import {Play} from "./play.js";
import type {Audio} from "./audio.js";

declare const sampleRate: number;
declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
type WorkletMessageEvent = {data: unknown};
interface WorkletMessagePort {
	onmessage: ((event: WorkletMessageEvent) => void) | null;
	postMessage(data: unknown): void;
}
declare class AudioWorkletProcessor {
	readonly port: WorkletMessagePort;
	constructor();
}

type SendMessage =
	| {name: "bin"; bin: ArrayBuffer}
	| {name: "getTracks"}
	| {name: "start"; data: {name: string; volume: number}}
	| {name: "clear"};

type RecvMessage = {name: "tracks"; tracks: string[]};
type PlayEntry = [[number], string, number];
type ResolvedPlayEntry = [[number], Audio, number];

let plays: PlayEntry[] = [];

class TestProcessor extends AudioWorkletProcessor {
	play?: ReturnType<typeof Play.parseBin>;
	constructor() {
		super();
		this.port.onmessage = (e) => {
			const message = e.data as SendMessage;
			switch (message.name) {
				case "bin":
					this.play = Play.parseBin(message.bin);
					break;
				case "getTracks":
					this.postMessage({
						name: "tracks",
						tracks: this.play ? [...this.play.audios.keys()] : [],
					});
					break;
				case "start":
					plays.push([[0], message.data.name, message.data.volume]);
					break;
				case "clear":
					plays = [];
					break;
			}
		};
	}

	postMessage(message: RecvMessage) {
		this.port.postMessage(message);
	}

	process(
		_inputs: Float32Array[][],
		outputs: Float32Array[][],
		_parameters: Record<string, Float32Array>,
	) {
		const output = outputs[0];
		const mplays = plays
			.map((play) => [play[0], this.play?.audios.get(play[1]), play[2]] as const)
			.filter((play): play is ResolvedPlayEntry => Boolean(play[1]));
		if (!mplays.length) return true;
		const channel = output[0];

		for (let i = 0; i < channel.length; i++) {
			let av = 0;
			for (const play of mplays) {
				const vol = play[1].getNumber((play[0][0] / sampleRate) * 1000) * play[2];
				if (vol !== 0) {
					av += mixAudio(av, vol);
				}

				play[0][0]++;
			}
			channel[i] = av;
		}
		plays = mplays
			.filter((play) => !play[1].isdone((play[0][0] / sampleRate) * 1000))
			.map((_) => [_[0], _[1].name, _[2]]);

		return true;
	}
}

registerProcessor("audio", TestProcessor);
