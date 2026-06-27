import {getPreferences, UserPreferences} from "./storage/userPreferences.js";

export type NotificationSoundConfig = {
	name: string;
} & (
	| {type: "single"; path: string}
	| {type: "multiple"; paths: string[]}
	| {type: "segments"; path: string; segments: [number, number][]} // How? why? pizza! you may ask??? well [start, duration] is your awnser!
);

export const BUILTIN_NOTIFICATION_SOUNDS: NotificationSoundConfig[] = [
	{name: "Default", type: "single", path: "/audio/sounds/Default.ogg"},
	{
		name: "Waves",
		type: "segments",
		path: "/audio/sounds/waves.ogg",
		segments: [
			[0.0, 0.4],
			[0.4, 0.4],
			[0.8, 0.4],
			[1.2, 0.4],
		],
	},
];

const ACCEPTED_AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/ogg", "audio/webm"]);
const ACCEPTED_AUDIO_EXTENSIONS = /\.(mp3|ogg|webm)$/i;

export class NotificationSoundManager {
	private static context = new AudioContext();
	private static buffers = new Map<string, AudioBuffer>();
	private static loadingBuffers = new Map<string, Promise<AudioBuffer>>();

	static getAvailableSounds(prefs: UserPreferences): NotificationSoundConfig[] {
		return [...BUILTIN_NOTIFICATION_SOUNDS, ...(prefs.customNotificationSounds ?? [])];
	}

	static getSelectedConfig(prefs: UserPreferences): NotificationSoundConfig {
		const sounds = this.getAvailableSounds(prefs);
		return sounds.find((s) => s.name === prefs.notificationSound) ?? BUILTIN_NOTIFICATION_SOUNDS[0];
	}

	static async playFromPreferences(prefs?: UserPreferences) {
		try {
			const p = prefs ?? (await getPreferences());
			await this.play(this.getSelectedConfig(p), p.notificationVolume);
		} catch (e) {
			console.warn("Can't play notification sound from preferences", e);
		}
	}

	static async preload(prefs?: UserPreferences) {
		const sounds = prefs ? this.getAvailableSounds(prefs) : BUILTIN_NOTIFICATION_SOUNDS;
        console.log("Preloading notification sounds:", sounds.map(s => s.name));
		await Promise.all(
			sounds.flatMap((sound) => {
				switch (sound.type) {
					case "single":
					case "segments":
						return this.getBuffer(sound.path);

					case "multiple":
						return sound.paths.map((path) => this.getBuffer(path));
				}
			}),
		);
	}

	private static async getBuffer(path: string): Promise<AudioBuffer> {
		const cached = this.buffers.get(path);
		if (cached) return cached;

		const loading = this.loadingBuffers.get(path);
		if (loading) return loading;

		const promise = (async () => {
			const response = await fetch(path);
			const data = await response.arrayBuffer();
			const buffer = await this.context.decodeAudioData(data);

			this.buffers.set(path, buffer);
			this.loadingBuffers.delete(path);

			return buffer;
		})();

		this.loadingBuffers.set(path, promise);

		return promise;
	}

	static async play(config?: NotificationSoundConfig, volume = 75) {
		if (!config) {
			config = BUILTIN_NOTIFICATION_SOUNDS[0];
		}

		let audioPath: string;
		let startTime = 0;
		let duration: number | undefined;

		switch (config.type) {
			case "single":
				audioPath = config.path;
				break;

			case "multiple":
				if (config.paths.length === 0) return;
				audioPath = config.paths[Math.floor(Math.random() * config.paths.length)];
				break;

			case "segments":
				if (config.segments.length === 0) return;

				const [start, dur] = config.segments[Math.floor(Math.random() * config.segments.length)];

				audioPath = config.path;
				startTime = start;
				duration = dur;
				break;
		}

		try {
			if (this.context.state === "suspended") {
				await this.context.resume();
			}

			const buffer = await this.getBuffer(audioPath);

			const source = this.context.createBufferSource();
			source.buffer = buffer;

			const gain = this.context.createGain();

			source.connect(gain);
			gain.connect(this.context.destination);

			const gainValue = Math.max(0, Math.min(1, volume / 100));
			const fade = 0.003;
			const when = this.context.currentTime + 0.002;

			gain.gain.setValueAtTime(0, when);
			gain.gain.linearRampToValueAtTime(gainValue, when + fade);

			if (duration !== undefined) {
				gain.gain.setValueAtTime(gainValue, when + duration - fade);
				gain.gain.linearRampToValueAtTime(0, when + duration);
				source.start(when, startTime, duration);
			} else {
				source.start(when);
			}
		} catch (e) {
			console.warn("Can't play notification sound", config.name, e);
		}
	}

	static isAcceptedAudioFile(file: File): boolean {
		return ACCEPTED_AUDIO_TYPES.has(file.type) || ACCEPTED_AUDIO_EXTENSIONS.test(file.name);
	}

	static readFileAsDataUrl(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				if (typeof reader.result === "string") resolve(reader.result);
				else reject(new Error("Invalid file data"));
			};
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});
	}
}
