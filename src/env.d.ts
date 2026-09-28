interface ImportMetaEnv {
	/** Vite sets this: true on the dev server (and in tests), false in a production build. */
	readonly DEV: boolean;
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
