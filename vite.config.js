import {defineConfig} from "vite";
import {resolve} from "path";
import {readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync} from "fs";
import {execSync} from "child_process";

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
		writeFileSync(resolve(outputDir, file), JSON.stringify(content, null, 2));
	}

	writeFileSync(
		resolve(outputDir, "langs.js"),
		`export const langs = ${JSON.stringify(langs, null, 2)};`,
	);
}

function generateBuildFiles() {
	const distDir = resolve(__dirname, "dist/webpage");
	const srcDir = resolve(__dirname, "src/webpage");
	const ver = process.env.VER;
	const urlRaw = process.env.URL;
	const normalizedUrl =
		urlRaw && URL.canParse(urlRaw)
			? urlRaw.endsWith("/")
				? urlRaw.slice(0, -1)
				: urlRaw
			: undefined;

	if (ver) {
		writeFileSync(resolve(distDir, "getupdates"), ver);
	} else {
		try {
			const revision = execSync("git rev-parse HEAD", {encoding: "utf-8"}).trim();
			writeFileSync(resolve(distDir, "getupdates"), revision);
		} catch {
			writeFileSync(resolve(distDir, "getupdates"), "dev");
		}
	}

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
}

const buildPlugin = () => ({
	name: "build-files-plugin",
	buildStart() {
		generateLangs();
	},
	configureServer(server) {
		generateLangs();
		server.middlewares.use(async (req, res, next) => {
			const path = req.url || "";

			if (path.startsWith("/channels")) {
				req.url = "/app.html";
			} else if (path.startsWith("/invite/")) {
				req.url = "/invite.html";
			} else if (path.startsWith("/template/")) {
				req.url = "/template.html";
			}

			next();
		});
	},
	closeBundle() {
		generateBuildFiles();
	},
});

export default defineConfig({
	root: resolve(__dirname, "src/webpage"),

	build: {
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
		hmr: {
			overlay: true,
		},
		middlewareMode: false,
	},

	appType: "spa",

	plugins: [buildPlugin()],
});
