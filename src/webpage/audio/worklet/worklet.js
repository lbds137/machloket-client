import {mixAudio} from "./mixAudio.js";
import {Play} from "./play.js";

let plays = [];

class TestProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.play = undefined;
		this.port.onmessage = (event) => {
			const message = event.data;
			switch (message.name) {
				case "bin":
					this.play = Play.parseBin(message.bin);
					break;
				case "getTracks":
					this.port.postMessage({
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

	process(_inputs, outputs) {
		const output = outputs[0];
		const mplays = plays
			.map((play) => [play[0], this.play?.audios.get(play[1]), play[2]])
			.filter((play) => Boolean(play[1]));
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
			.map((play) => [play[0], play[1].name, play[2]]);

		return true;
	}
}

registerProcessor("audio", TestProcessor);