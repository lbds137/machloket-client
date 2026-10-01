import {defineConfig} from "vite";
import {playwright} from "@vitest/browser-playwright";
import {resolve} from "path";
import {
	readFileSync,
	readdirSync,
	writeFileSync,
	mkdirSync,
	existsSync,
	statSync,
	rmSync,
} from "fs";
import {execSync} from "child_process";

// Extra hostnames the dev/preview servers accept (a reverse proxy may forward the original
// Host). Comma-separated env var, so no deployment's hostnames live in the repo:
// MACHLOKET_HOSTS=".example.ts.net" npx vite … — unset means Vite's own defaults.
const allowedHosts = process.env.MACHLOKET_HOSTS
	? process.env.MACHLOKET_HOSTS.split(",").map((host) => host.trim())
	: undefined;

// Unchanged files are left alone: the dev server watches src/webpage, and a rewrite, even
// identical, reloads every open page (a build or test run would reload the phone mid-test).
function writeIfChanged(path, content) {
	if (existsSync(path) && readFileSync(path, "utf-8") === content) return;
	writeFileSync(path, content);
}

function generateLangs() {
	const translationsDir = resolve(__dirname, "translations");
	const outputDir = resolve(__dirname, "src/webpage/translations");

	if (!existsSync(outputDir)) {
		mkdirSync(outputDir, {recursive: true});
	}

	const langs = {};
	const files = readdirSync(translationsDir).filter((f) => f.endsWith(".json") && f !== "qqq.json");

	for (const file of files) {
		const content = JSON.parse(readFileSync(resolve(translationsDir, file), "utf-8"));
		langs[file] = content.readableName;
		writeIfChanged(resolve(outputDir, file), JSON.stringify(content, null, 2));
	}

	writeIfChanged(
		resolve(outputDir, "langs.js"),
		`export const langs = ${JSON.stringify(langs, null, 2)};`,
	);
}

function getBuildVersion() {
	const ver = process.env.VER;
	if (ver) return ver.trim();
	try {
		return execSync("git rev-parse HEAD", {encoding: "utf-8"}).trim();
	} catch {
		return "dev";
	}
}

function listFilesRecursive(dir) {
	/** @type {string[]} */
	const files = [];
	for (const entry of readdirSync(dir)) {
		const fullPath = resolve(dir, entry);
		if (statSync(fullPath).isDirectory()) {
			files.push(...listFilesRecursive(fullPath));
		} else {
			files.push(fullPath);
		}
	}
	return files;
}

// Is is really meh meh but yk yk
function patchStylesheetCacheBusting(distDir, version) {
	const cacheVersion = version.slice(0, 12);
	const versionedStylesheets = new Set(["/style.css", "/themes.css"]);
	const bustScript = `<script>(function(){var v="${cacheVersion}";document.querySelectorAll('link[rel="stylesheet"]').forEach(function(l){var h=l.getAttribute("href");if(!h) return;var u=new URL(h,location.href);if(!["/style.css","/themes.css"].includes(u.pathname))return;if(u.searchParams.get("v")===v)return;u.searchParams.set("v",v);l.setAttribute("href",u.pathname+u.search);});})();</script>`;
	for (const file of listFilesRecursive(distDir)) {
		if (!file.endsWith(".html")) continue;
		let html = readFileSync(file, "utf-8");
		let changed = false;
		html = html.replace(/href="([^"]+\.css(?:\?[^"]*)?)"/g, (match, href) => {
			let pathname = href;
			try {
				pathname = new URL(href, "http://localhost").pathname;
			} catch {
				pathname = href.split("?")[0];
			}
			if (!versionedStylesheets.has(pathname)) return match;
			changed = true;
			return `href="${pathname}?v=${cacheVersion}"`;
		});
		if (!html.includes("machloketStylesheetBust")) {
			const patched = html.replace(
				/(<link href="\/(?:style|themes)\.css[^"]*" rel="stylesheet"[^>]*>)/,
				`${bustScript}<!--machloketStylesheetBust-->\n$1`,
			);
			if (patched !== html) {
				html = patched;
				changed = true;
			}
		}
		if (changed) writeFileSync(file, html);
	}
}

function generateBuildFiles() {
	const distDir = resolve(__dirname, "dist/webpage");
	const srcDir = resolve(__dirname, "src/webpage");
	const revision = getBuildVersion();

	writeFileSync(resolve(distDir, "getupdates"), revision);
	patchStylesheetCacheBusting(distDir, revision);

	writeFileSync(
		resolve(distDir, "_redirects"),
		`/channels/* /app 200
/invite/* /invite 200
/template/* /template 200`,
	);

	const legacyRuntimeFiles = ["emoji.bin", "manifest.json"];
	for (const file of legacyRuntimeFiles) {
		const srcPath = resolve(srcDir, file);
		const distPath = resolve(distDir, file);
		if (existsSync(srcPath)) {
			writeFileSync(distPath, readFileSync(srcPath));
		}
	}

	// The Machlakot artwork is for the dev server only (devBrandPlugin).
	rmSync(resolve(distDir, "brand/dev"), {recursive: true, force: true});

	// Android installs from the manifest; an icon that isn't shipped gets a generic letter tile.
	const manifest = JSON.parse(readFileSync(resolve(distDir, "manifest.json"), "utf-8"));
	for (const icon of [...manifest.icons, {src: "/favicon.ico"}]) {
		if (!existsSync(resolve(distDir, "." + icon.src))) {
			throw new Error(`The build ships no ${icon.src}, which the manifest or pages name`);
		}
	}

	// The service worker precaches every file listed here on each update (service.ts,
	// downloadAllFiles). Written last so it lists the files above too.
	const files = fileTree(distDir);
	files["files.json"] = "files.json";
	writeFileSync(resolve(distDir, "files.json"), JSON.stringify(files));

	const serviceWorker = resolve(distDir, "service.js");
	if (!existsSync(serviceWorker)) {
		throw new Error("The build emitted no service.js; offline caching needs it");
	}
	// A runtime import in service.ts would pull a shared chunk (possibly DOM code) into the worker.
	if (/(^|[;}\s])(import\s*[\w{*"'`(]|export\s*[{*])/.test(readFileSync(serviceWorker, "utf-8"))) {
		throw new Error("service.js imports or exports something; keep service.ts self-contained");
	}
}

/** `{name: name}` for files and `{name: {...}}` for directories; hidden files are skipped. */
function fileTree(dir) {
	const tree = {};
	for (const entry of readdirSync(dir)) {
		if (entry.startsWith(".")) continue;
		const fullPath = resolve(dir, entry);
		tree[entry] = statSync(fullPath).isDirectory() ? fileTree(fullPath) : entry;
	}
	return tree;
}

const buildPlugin = () => ({
	name: "build-files-plugin",
	buildStart() {
		generateLangs();
	},
	configureServer(server) {
		generateLangs();
		server.middlewares.use(clientRouteFallback);
	},
	// The production preview needs the same client-route rewrites: without them a deep link
	// 404s (bare static serving) or lands on the marketing index.html instead of the app.
	configurePreviewServer(server) {
		server.middlewares.use(clientRouteFallback);
	},
	closeBundle() {
		generateBuildFiles();
	},
});

/** Client routes are served by the page that implements them — the default SPA fallback
 * would serve the marketing landing page for /channels, and a bare static server 404s. */
const clientRouteFallback = (req, res, next) => {
	const path = (req.url || "").split("?")[0];

	if (path.startsWith("/channels")) {
		req.url = "/app.html";
	} else if (path.startsWith("/invite/")) {
		req.url = "/invite.html";
	} else if (path.startsWith("/template/")) {
		req.url = "/template.html";
	}

	next();
};

// The dev server brands itself Machlakot (brand.ts), so an install from it can't pass for the
// production app: the brand URLs are answered from public/brand/dev/, and names are swapped in
// the pages and the manifest. The manifest keeps its `id`, so an installed app updates in place.
const devBrandPlugin = () => ({
	name: "dev-brand",
	apply: "serve",
	configureServer(server) {
		server.middlewares.use((req, res, next) => {
			const path = (req.url || "").split("?")[0];
			if (path === "/manifest.json") {
				const manifest = JSON.parse(
					readFileSync(resolve(__dirname, "src/webpage/public/manifest.json"), "utf-8"),
				);
				manifest.name = manifest.short_name = "Machlakot";
				manifest.background_color = "#170A08";
				res.setHeader("Content-Type", "application/manifest+json");
				res.end(JSON.stringify(manifest));
				return;
			}
			if (path === "/favicon.ico") {
				req.url = "/brand/dev/favicon.ico";
			} else if (path === "/logo.svg") {
				req.url = "/brand/dev/icon.svg";
			} else if (path === "/logo.webp") {
				req.url = "/brand/dev/logo.webp";
			} else if (path.startsWith("/brand/") && !path.startsWith("/brand/dev/")) {
				req.url = "/brand/dev/" + path.slice("/brand/".length);
			}
			next();
		});
	},
	transformIndexHtml(html) {
		return html.replaceAll("Machloket", "Machlakot");
	},
});

export default defineConfig({
	root: resolve(__dirname, "src/webpage"),
	envPrefix: ["VITE_"],

	build: {
		sourcemap: "hidden",
		outDir: resolve(__dirname, "dist/webpage"),
		emptyOutDir: true,
		rollupOptions: {
			input: {
				main: resolve(__dirname, "src/webpage/index.html"),
				app: resolve(__dirname, "src/webpage/app.html"),
				login: resolve(__dirname, "src/webpage/login.html"),
				register: resolve(__dirname, "src/webpage/register.html"),
				invite: resolve(__dirname, "src/webpage/invite.html"),
				reset: resolve(__dirname, "src/webpage/reset.html"),
				template: resolve(__dirname, "src/webpage/template.html"),
				404: resolve(__dirname, "src/webpage/404.html"),
				"oauth2/authorize": resolve(__dirname, "src/webpage/oauth2/authorize.html"),
				"audio/index": resolve(__dirname, "src/webpage/audio/index.html"),
				service: resolve(__dirname, "src/webpage/service.ts"),
			},
			output: {
				// The service worker must sit at /service.js under a stable name: its URL is its
				// identity (utils.ts, SW.register) and its scope is the directory it's served from.
				entryFileNames: (chunk) =>
					chunk.name === "service" ? "service.js" : "assets/[name]-[hash].js",
			},
		},
	},

	resolve: {
		alias: {
			"@": resolve(__dirname, "src/webpage"),
		},
	},

	server: {
		port: 8080,
		host: true,
		allowedHosts,
		hmr: {
			overlay: true,
		},
		middlewareMode: false,
	},

	preview: {
		port: 8081,
		host: true,
		allowedHosts,
	},

	appType: "spa",

	plugins: [buildPlugin(), devBrandPlugin()],

	// Tests run in headless Chromium: the app's modules import each other in cycles that only
	// evaluate correctly under native browser ESM.
	test: {
		include: ["**/*.test.ts"],
		setupFiles: [resolve(__dirname, "src/webpage/test/setup.ts")],
		browser: {
			enabled: true,
			provider: playwright(),
			headless: true,
			instances: [{browser: "chromium"}],
		},
	},
});
