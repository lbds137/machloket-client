import http from "http";
import {spawn} from "child_process";
import {readFile, access} from "node:fs/promises";
import {createReadStream, constants as fsConstants} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || process.argv[2] || 8080);
const distRoot = path.join(__dirname, "dist");
const webpageRoot = path.join(distRoot, "webpage");
const clients = new Set();
let reloadPending = false;

function guessMime(file) {
	const ext = path.extname(file).toLowerCase();
	switch (ext) {
		case ".js":
			return "text/javascript";
		case ".html":
			return "text/html";
		case ".css":
			return "text/css";
		case ".svg":
			return "image/svg+xml";
		case ".ico":
			return "image/x-icon";
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		case ".woff":
			return "font/woff";
		case ".woff2":
			return "font/woff2";
		case ".map":
			return "application/json";
		case ".txt":
			return "text/plain";
		case ".json":
			return "application/json";
		default:
			return "application/octet-stream";
	}
}

function injectReloadScript(html) {
	const script = `\n<script>
	const source = new EventSource('/__refresh');
	source.onmessage = (event) => {
		if (event.data === 'reload') {
			window.location.reload();
		}
	};
	source.onerror = () => {
		console.warn('Live reload disconnected, reloading in 3 seconds');
		setTimeout(() => window.location.reload(), 3000);
	};
</script>\n`;
	if (html.includes("</body>")) {
		return html.replace("</body>", `${script}</body>`);
	}
	if (html.includes("</head>")) {
		return html.replace("</head>", `${script}</head>`);
	}
	return html + script;
}

async function exists(filePath) {
	try {
		await access(filePath, fsConstants.R_OK);
		return true;
	} catch {
		return false;
	}
}

function safeWrite(client, data) {
	try {
		client.write(data);
		return true;
	} catch {
		return false;
	}
}

function broadcastReload() {
	if (reloadPending) return;
	reloadPending = true;
	setTimeout(() => {
		for (const client of clients) {
			if (!safeWrite(client, "data: reload\n\n")) {
				clients.delete(client);
			}
		}
		reloadPending = false;
	}, 100);
}

function getStaticFilePath(urlPath) {
	if (urlPath === "/") {
		return path.join(webpageRoot, "index.html");
	}
	if (urlPath.startsWith("/invite/")) {
		return path.join(webpageRoot, "invite.html");
	}
	if (urlPath.startsWith("/template/")) {
		return path.join(webpageRoot, "template.html");
	}
	if (urlPath.startsWith("/channels")) {
		return path.join(webpageRoot, "app.html");
	}
	const normalized = path.posix
		.normalize(urlPath)
		.replace(/^([\.]{2}[\/\\])+/, "")
		.replace(/^\/+/, "");
	const filePath = path.join(webpageRoot, normalized);

	if (!filePath.startsWith(webpageRoot)) {
		return null;
	}

	if (!path.extname(normalized) && !normalized.endsWith(".")) {
		return path.join(webpageRoot, normalized + ".html");
	}

	return filePath;
}

async function sendStaticFile(pathname, res) {
	const filePath = getStaticFilePath(pathname);
	if (!filePath || !(await exists(filePath))) {
		res.writeHead(404, {"Content-Type": "text/plain"});
		res.end("Not found");
		return;
	}

	const mime = guessMime(filePath);
	res.writeHead(200, {"Content-Type": mime});
	if (mime === "text/html") {
		const html = await readFile(filePath, "utf8");
		res.end(injectReloadScript(html));
		return;
	}
	createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
	if (!req.url) {
		res.writeHead(400);
		res.end("Bad request");
		return;
	}
	const url = new URL(req.url, `http://localhost`);
	if (url.pathname === "/__refresh") {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		res.write("retry: 1000\n\n");
		clients.add(res);
		req.on("close", () => {
			clients.delete(res);
		});
		res.on("error", () => {
			clients.delete(res);
		});
		return;
	}
	await sendStaticFile(url.pathname, res);
});

let buildProcess;
let isShuttingDown = false;

async function shutdown(exitCode = 0) {
	if (isShuttingDown) return;
	isShuttingDown = true;
	console.log("Shutting down dev server...");

	if (buildProcess && !buildProcess.killed) {
		buildProcess.kill("SIGINT");
	}

	server.close((err) => {
		if (err) {
			console.error("Error closing server:", err);
		}
		process.exit(exitCode);
	});

	setTimeout(() => {
		console.warn("Forced exit after timeout.");
		process.exit(exitCode);
	}, 5000).unref();
}

async function startBuildWatch() {
	console.log("Starting build watch...");
	buildProcess = spawn("node", [path.join(__dirname, "build.js"), "watch"], {
		cwd: __dirname,
		stdio: ["ignore", "pipe", "inherit"],
	});

	let buffered = "";
	buildProcess.stdout.on("data", (chunk) => {
		const text = chunk.toString();
		process.stdout.write(text);
		buffered += text;
		let index;
		while ((index = buffered.indexOf("\n")) >= 0) {
			const line = buffered.slice(0, index).trim();
			buffered = buffered.slice(index + 1);
			if (line.startsWith("build:")) {
				broadcastReload();
			}
		}
	});

	buildProcess.on("exit", (code) => {
		if (code !== 0) {
			console.error(`build.js exited with code ${code}`);
		}
		if (!isShuttingDown) {
			process.exit(code ?? 0);
		}
	});

	return buildProcess;
}

async function run() {
	console.log(`Server listening on http://localhost:${PORT}`);
	await startBuildWatch();
	server.listen(PORT);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
run().catch((error) => {
	console.error(error);
	process.exit(1);
});
