interface ImportMetaEnv {
	readonly VITE_OP_CLIENT_ID?: string;
	readonly VITE_OP_API_URL?: string;
	readonly VITE_OP_REPLAY_SAMPLE_RATE?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
