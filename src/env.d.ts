interface ImportMetaEnv {
	/** Vite sets this: true on the dev server (and in tests), false in a production build. */
	readonly DEV: boolean;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
