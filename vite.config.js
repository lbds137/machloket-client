import { defineConfig } from "vite";
import { resolve } from "path";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, cpSync, lstatSync } from "fs";
import { execSync } from "child_process";

function generateLangs() {
  const translationsDir = resolve(__dirname, "translations");
  const outputDir = resolve(__dirname, "src/webpage/translations");
  
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  
  const langs = {};
  const files = readdirSync(translationsDir).filter(f => f.endsWith(".json") && f !== "qqq.json");
  
  for (const file of files) {
    const content = JSON.parse(readFileSync(resolve(translationsDir, file), "utf-8"));
    langs[file] = content.readableName;
    writeFileSync(resolve(outputDir, file), JSON.stringify(content, null, 2));
  }

  writeFileSync(
    resolve(outputDir, "langs.js"),
    `export const langs = ${JSON.stringify(langs, null, 2)};`
  );
}

function generateBuildFiles() {
  const distDir = resolve(__dirname, "dist/webpage");
  const srcDir = resolve(__dirname, "src/webpage");
  const ver = process.env.VER;
  const urlRaw = process.env.URL;
  const normalizedUrl =
    urlRaw && URL.canParse(urlRaw)
      ? (urlRaw.endsWith("/") ? urlRaw.slice(0, -1) : urlRaw)
      : undefined;

  if (ver) {
    writeFileSync(resolve(distDir, "getupdates"), ver);
  } else {
    try {
      const revision = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
      writeFileSync(resolve(distDir, "getupdates"), revision);
    } catch {
      writeFileSync(resolve(distDir, "getupdates"), "dev");
    }
  }

  writeFileSync(
    resolve(distDir, "_redirects"),
    `/channels/* /app 200
/invite/* /invite 200
/template/* /template 200`
  );

  if (existsSync(resolve(srcDir, "robots.txt"))) {
    const robotsPath = resolve(distDir, "robots.txt");
    cpSync(resolve(srcDir, "robots.txt"), robotsPath);
    if (normalizedUrl) {
      const robots = readFileSync(robotsPath, "utf-8") + `\n\nSitemap: ${normalizedUrl}/sitemap.xml`;
      writeFileSync(robotsPath, robots);
    }
  }

  if (existsSync(resolve(srcDir, "sitemap.xml"))) {
    const sitemapPath = resolve(distDir, "sitemap.xml");
    cpSync(resolve(srcDir, "sitemap.xml"), sitemapPath);
    if (normalizedUrl) {
      const sitemap = readFileSync(sitemapPath, "utf-8").replaceAll("$$$", normalizedUrl);
      writeFileSync(sitemapPath, sitemap);
    }
  }

  // Preserve legacy build behavior for files fetched directly at runtime.
  const runtimeStaticFiles = ["emoji.bin", "instances.json", "manifest.json"];
  for (const file of runtimeStaticFiles) {
    const srcPath = resolve(srcDir, file);
    const distPath = resolve(distDir, file);
    if (existsSync(srcPath)) {
      cpSync(srcPath, distPath);
    }
  }

  const srcTranslationsDir = resolve(srcDir, "translations");
  const distTranslationsDir = resolve(distDir, "translations");
  if (existsSync(srcTranslationsDir)) {
    if (!existsSync(distTranslationsDir)) {
      mkdirSync(distTranslationsDir, { recursive: true });
    }
    const transFiles = readdirSync(srcTranslationsDir);
    for (const file of transFiles) {
      cpSync(resolve(srcTranslationsDir, file), resolve(distTranslationsDir, file));
    }
  }

  function crawlDir(dir) {
    const dirs = readdirSync(dir);
    const m = dirs.map(file => {
      const idir = resolve(dir, file);
      const stats = lstatSync(idir);
      if (stats.isDirectory()) {
        return [file, crawlDir(idir)];
      } else {
        if (file.startsWith(".")) return [file, undefined];
        return [file, file];
      }
    });
    const obj = {};
    m.forEach(_ => { if (_[1]) obj[_[0]] = _[1]; });
    return obj;
  }
  
  const dir = crawlDir(distDir);
  dir["files.json"] = "files.json";
  writeFileSync(resolve(distDir, "files.json"), JSON.stringify(dir));
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
      }
      else if (path.startsWith("/invite/")) {
        req.url = "/invite.html";
      }
      else if (path.startsWith("/template/")) {
        req.url = "/template.html";
      }
      
      next();
    });
  },
  closeBundle() {
    generateBuildFiles();
  }
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
        "404": resolve(__dirname, "src/webpage/404.html"),
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