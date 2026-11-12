interface ImportMetaEnv {
	/** Vite sets this: true on the dev server (and in tests), false in a production build. */
	readonly DEV: boolean;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

/** The build revision, injected by vite.config.js (`define`); service.ts logs it so a new
 * build's service.js differs byte-wise and the browser reinstalls the worker. */
declare const __BUILD_REVISION__: string;
