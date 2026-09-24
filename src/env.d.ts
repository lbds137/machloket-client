interface ImportMetaEnv {
	readonly FORCELOCALINSTANCE?: string;
	readonly VITE_OP_CLIENT_ID?: string;
	readonly VITE_OP_API_URL?: string;
	readonly VITE_OP_REPLAY_SAMPLE_RATE?: string;
	readonly VITE_SENTRY_DSN?: string;
	readonly VITE_SENTRY_TUNNEL?: string;
	readonly VITE_SENTRY_ENVIRONMENT?: string;
	readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
