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
import {mergeInstanceLists} from "./src/webpage/utils/instanceOverlay.ts";
import {sourceUrl} from "./src/webpage/utils/sourceOffer.ts";
import {printTestTree} from "./e2e/testTree.ts";
import {
	CONTENT_SECURITY_POLICY,
	pagesHeadersFile,
} from "./src/webpage/utils/contentSecurityPolicy.ts";

// Dev and build load this config too, and neither is a test run.
if (process.env.VITEST) printTestTree("vitest");

// A deployment's own instances (git-ignored, so public builds and CI never see one) lead the
// served instance list: the picker's default is then that deployment's instance. See
// instanceOverlay.ts. The public file itself is never rewritten.
const instanceOverlayPath = resolve(__dirname, "docs/local/instances.json");
function servedInstances() {
	const publicList = JSON.parse(
		readFileSync(resolve(__dirname, "src/webpage/public/instances.json"), "utf-8"),
	);
	const overlay = existsSync(instanceOverlayPath)
		? JSON.parse(readFileSync(instanceOverlayPath, "utf-8"))
		: undefined;
	return JSON.stringify(mergeInstanceLists(publicList, overlay), null, "\t") + "\n";
}

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

// The unhashed stylesheets get the build's version as a query, so a new build's pages never pair
// with a cached old sheet. (An inline script used to re-apply the same query at runtime; it never
// changed a link the rewrite below had already versioned, and the CSP refuses inline script.)
function patchStylesheetCacheBusting(distDir, version) {
	const cacheVersion = version.slice(0, 12);
	const versionedStylesheets = new Set(["/style.css", "/themes.css"]);
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
		if (changed) writeFileSync(file, html);
	}
}

/** Refuses a build the Content-Security-Policy would break at runtime: an inline <script> in a
 * page (script-src has no 'unsafe-inline') or an eval-like call in the emitted code (no
 * 'unsafe-eval'). Each returns the offending files, so the error names them. */
function inlineScriptPages(distDir) {
	return listFilesRecursive(distDir).filter(
		(file) =>
			file.endsWith(".html") &&
			// An empty src counts as inline. Comments are not stripped: a regex can't tell a real
			// comment from "<!--" inside an attribute, so stripping could hide a live script. A
			// commented-out inline script fails the build too; delete it from the page.
			/<script\b(?![^>]*\bsrc\s*=\s*["']?[^\s"'>])[^>]*>/i.test(readFileSync(file, "utf-8")),
	);
}
/** The policy and the one module it imports: both go in the policy's own chunk. */
const TRUSTED_TYPES_MODULES = /[\\/]utils[\\/](trustedTypes|contentSecurityPolicy)\.ts$/;
/** Pages whose first module script isn't the Trusted Types policy's chunk: anything that runs
 * before it meets a document that refuses every script sink. */
function policyLastPages(distDir) {
	return listFilesRecursive(distDir).filter((file) => {
		if (!file.endsWith(".html")) return false;
		const first = /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/i.exec(
			readFileSync(file, "utf-8"),
		);
		return !first || !/^\/assets\/trustedTypes-[\w-]+\.js$/.test(first[1]);
	});
}
/** Policy chunks that import anything: an imported chunk's top-level code runs before the
 * policy's own, so being loaded first isn't enough. */
function importingPolicyChunks(distDir) {
	return listFilesRecursive(distDir).filter(
		(file) =>
			/[\\/]trustedTypes-[\w-]+\.js$/.test(file) && /\bimport\b/.test(readFileSync(file, "utf-8")),
	);
}
function evalCallFiles(distDir) {
	return listFilesRecursive(distDir).filter(
		(file) =>
			file.endsWith(".js") &&
			// A bare call, or one through the global object (window.eval, globalThis.Function).
			// Not caught here: a string to setTimeout/setInterval, or x.constructor("..."). The CSP
			// refuses those at runtime too, and the e2e violation net reports them where it reaches.
			/(^|[^\w$.]|\b(?:window|globalThis|self)\s*\.\s*)(eval\s*\(|(new\s+)?Function\s*\()/.test(
				readFileSync(file, "utf-8"),
			),
	);
}

function generateBuildFiles() {
	const distDir = resolve(__dirname, "dist/webpage");
	const srcDir = resolve(__dirname, "src/webpage");
	const revision = getBuildVersion();

	writeFileSync(resolve(distDir, "getupdates"), revision);
	writeFileSync(resolve(distDir, "instances.json"), servedInstances());
	patchStylesheetCacheBusting(distDir, revision);

	writeFileSync(
		resolve(distDir, "_redirects"),
		`/channels/* /app 200
/invite/* /invite 200
/template/* /template 200`,
	);
	// The Content-Security-Policy, from the same source the preview server sends it from.
	writeFileSync(resolve(distDir, "_headers"), pagesHeadersFile());

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

	const inlineScripts = inlineScriptPages(distDir);
	if (inlineScripts.length) {
		throw new Error(`Inline <script> in ${inlineScripts.join(", ")}: the CSP refuses it`);
	}
	const policyLast = policyLastPages(distDir);
	if (policyLast.length) {
		throw new Error(
			`${policyLast.join(", ")} load code before the Trusted Types policy (utils/trustedTypes.ts)`,
		);
	}
	const importingPolicy = importingPolicyChunks(distDir);
	if (importingPolicy.length) {
		throw new Error(
			`${importingPolicy.join(", ")} imports another chunk, whose code runs before the policy`,
		);
	}
	const evalCalls = evalCallFiles(distDir);
	if (evalCalls.length) {
		throw new Error(`eval or Function() in ${evalCalls.join(", ")}: the CSP refuses it`);
	}

	// The service worker precaches every file listed here on each update (service.ts,
	// downloadAllFiles). Written last so it lists the files above too. The host's own config
	// files aren't app files (Pages doesn't serve them).
	const files = fileTree(distDir);
	delete files["_headers"];
	delete files["_redirects"];
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
		// Test-only control over what /getupdates answers: the vitest dev server has no
		// dist/getupdates file (a production build writes it), so without an override the SPA
		// fallback serves index.html there and the service worker can't be exercised against
		// real update payloads. Never runs outside vitest: the preview server (e2e) and the
		// build register nothing, and prod serves the real file.
		if (process.env.VITEST) {
			let swUpdatesOverride;
			server.middlewares.use((req, res, next) => {
				const url = new URL(req.url || "/", "http://localhost");
				if (url.pathname === "/__test/sw-updates") {
					const body = url.searchParams.get("body");
					swUpdatesOverride =
						body === null
							? undefined
							: {
									body,
									contentType: url.searchParams.get("type") || "text/plain",
									status: Number.parseInt(url.searchParams.get("status") || "200", 10),
									fail: url.searchParams.has("fail"),
									files: url.searchParams.has("files") ? url.searchParams.get("files") : undefined,
									filesFail: url.searchParams.has("filesFail"),
								};
					res.setHeader("Content-Type", "application/json");
					res.end(JSON.stringify({ok: true, set: swUpdatesOverride ?? null}));
					return;
				}
				if (url.pathname === "/files.json" && swUpdatesOverride) {
					// A set `files` answers the worker's file manifest with that body (so a test's
					// download succeeds); `filesFail` destroys the connection like `fail` above,
					// exercising the failed-download path. Neither set: default passthrough.
					if (swUpdatesOverride.filesFail) {
						res.socket?.destroy();
						return;
					}
					if (swUpdatesOverride.files !== undefined) {
						res.statusCode = 200;
						res.setHeader("Content-Type", "application/json");
						res.end(swUpdatesOverride.files);
						return;
					}
				}
				if (url.pathname === "/getupdates" && swUpdatesOverride) {
					// A set `fail` kills the connection instead of answering: the worker's fetch
					// throws, exercising its failed-check path.
					if (swUpdatesOverride.fail) {
						res.socket?.destroy();
						return;
					}
					res.statusCode = swUpdatesOverride.status;
					res.setHeader("Content-Type", swUpdatesOverride.contentType);
					res.end(swUpdatesOverride.body);
					return;
				}
				next();
			});
			// Reserved missing-emoji id: a real 404 from the CDN (empty body) for
			// brokenImageFallback.test.ts, which renders this id to pin the failed-network path.
			server.middlewares.use((req, res, next) => {
				const pathname = new URL(req.url || "/", "http://localhost").pathname;
				if (pathname === "/emojis/404404404404404404.png") {
					res.statusCode = 404;
					res.end();
					return;
				}
				next();
			});
			// Test-only CDN stub, mirroring the e2e mock (e2e/mock/index.ts answers /emojis/* with a
			// 1x1 PNG): emoji fixtures load as they would against a real CDN, instead of the SPA's
			// index.html, which would make every emoji image fail and fall back.
			const TEST_PIXEL_PNG = Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
				"base64",
			);
			server.middlewares.use((req, res, next) => {
				const pathname = new URL(req.url || "/", "http://localhost").pathname;
				if (pathname.startsWith("/emojis/") && /\.(png|gif|webp)$/.test(pathname)) {
					res.statusCode = 200;
					res.setHeader("Content-Type", "image/png");
					res.end(TEST_PIXEL_PNG);
					return;
				}
				next();
			});
		}
		// Read per request, so an edited overlay shows up on the next page load.
		server.middlewares.use((req, res, next) => {
			if ((req.url || "").split("?")[0] !== "/instances.json") return next();
			res.setHeader("Content-Type", "application/json");
			try {
				res.end(servedInstances());
			} catch (err) {
				next(err);
			}
		});
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

// Vite 8 replaces `define` values only in bundled environments: a dev/vitest client module is
// served raw, so the worker's revision line (service.ts) would read an undefined identifier
// and kill the worker at evaluation. Replace it there too — but not in modules that embed
// service.ts as text (the ?raw imports the hardcodedText test scans), where a splice would
// corrupt the string literal.
const buildRevisionPlugin = () => ({
	name: "build-revision",
	transform(code, id) {
		const [file, query] = id.split("?");
		// A leading raw/url/inline load query means the module is embedded as text (possibly
		// with more params after it), and a spliced revision would corrupt that string.
		// Exact resolved-path match: a suffix check would also catch a sibling like
		// anotherService.ts (or any deeper path ending the same way).
		if (
			resolve(file) !== resolve(__dirname, "src/webpage/service.ts") ||
			/^(raw|url|inline)(&|$)/.test(query || "")
		)
			return;
		return code.replaceAll("__BUILD_REVISION__", JSON.stringify(getBuildVersion()));
	},
});

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

	// The service worker logs its build revision (service.ts): with the worker served under a
	// stable name, this one differing line is what makes the browser ever reinstall it.
	define: {
		__BUILD_REVISION__: JSON.stringify(getBuildVersion()),
		// Client information's "source for this build" (AGPL-3.0 section 13; utils/sourceOffer.ts).
		// MACHLOKET_SOURCE_URL names the repository a modified build's source is published in.
		__SOURCE_URL__: JSON.stringify(sourceUrl(process.env.MACHLOKET_SOURCE_URL, getBuildVersion())),
	},

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
				// The Trusted Types default policy gets a chunk of its own, which each page loads
				// first. Left to the bundler it is inlined into the entry chunk, whose body runs
				// after the shared chunks it imports, so their top-level code (the service
				// worker's registration) met a document with no policy yet. policyLastPages
				// refuses a build that loads it anywhere but first.
				codeSplitting: {
					groups: [{name: "trustedTypes", test: TRUSTED_TYPES_MODULES, priority: 100}],
				},
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
		// The deployed policy (the build's _headers file), so the e2e tier runs under it.
		headers: {"Content-Security-Policy": CONTENT_SECURITY_POLICY},
	},

	appType: "spa",

	plugins: [buildPlugin(), devBrandPlugin(), buildRevisionPlugin()],

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
