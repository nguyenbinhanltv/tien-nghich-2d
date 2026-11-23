import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
/** Pixel Kiln output root. Override with TN2D_ASSETS_DIR (the hot-reload test points it at a temp copy). */
const ASSETS = resolve(process.env.TN2D_ASSETS_DIR ?? join(here, "../../assets"));
const MIME: Record<string, string> = {
  ".png": "image/png", ".json": "application/json", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".webp": "image/webp",
};
const PACKS = ["pilot_v1", "wave2_batch1_v1", "wave2_batch2_v1", "wave2_batch3_v1", "wave2_batch4_v1", "branches_v1"];

/** What the game is allowed to read from assets/ (mobile atlas + audio manifest + packs). */
function allowed(rel: string): boolean {
  return (
    /^atlases\/mobile\/atlas-\d+\.(png|json)$/.test(rel) ||
    rel === "audio_manifest.json" ||
    new RegExp(`^audio/packs/(${PACKS.join("|")})/(pack\\.json|sfx_sprite\\.(ogg|m4a)|bgm_[a-z_]+\\.(ogg|m4a))$`).test(rel)
  );
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? listFiles(join(dir, d.name)) : [join(dir, d.name)]));
}

function kiln(): Plugin {
  const serveAssets = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use("/assets", (req, res, next) => {
      const rel = decodeURIComponent((req.url ?? "").split("?")[0]!).replace(/^\//, "");
      if (!allowed(rel)) return next();
      const file = join(ASSETS, rel);
      if (!existsSync(file)) return next();
      res.setHeader("Content-Type", MIME[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.end(readFileSync(file));
    });
  };
  return {
    name: "kiln-assets",
    configureServer(server) {
      serveAssets(server);
      // Hot reload: watch the mobile atlas pages and tell the page which ones changed (Vite websocket, loopback).
      const dir = join(ASSETS, "atlases/mobile");
      if (!existsSync(dir)) return;
      let pending = new Set<string>();
      let timer: NodeJS.Timeout | undefined;
      watch(dir, (_ev, name) => {
        if (!name || !/^atlas-\d+\.(png|json)$/.test(name)) return;
        pending.add(`atlases/mobile/${name}`);
        clearTimeout(timer);
        timer = setTimeout(() => {
          const files = [...pending];
          pending = new Set();
          server.ws.send({ type: "custom", event: "kiln:update", data: { files, t: Date.now() } });
        }, 40); // png + json land a few ms apart
      });
    },
    configurePreviewServer: serveAssets,
    closeBundle() {
      // Stage the assets the game reads next to the bundle, then generate the service worker.
      const dist = join(here, "dist");
      if (!existsSync(dist)) return;
      const stage = (rel: string) => {
        const src = join(ASSETS, rel);
        if (!existsSync(src)) return;
        const dst = join(dist, "assets", rel);
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
      };
      for (const f of readdirSync(join(ASSETS, "atlases/mobile"))) if (allowed(`atlases/mobile/${f}`)) stage(`atlases/mobile/${f}`);
      stage("audio_manifest.json");
      for (const p of PACKS) for (const f of readdirSync(join(ASSETS, "audio/packs", p))) if (allowed(`audio/packs/${p}/${f}`)) stage(`audio/packs/${p}/${f}`);
      // Precache: shell + atlas pages + audio manifest + SFX sprites + pack tables (both codecs; ~1.1 MB). BGM (~1 MB each) is cached on first play.
      const all = listFiles(dist)
        .map((f) => relative(dist, f).split(sep).join("/"))
        .filter((f) => f !== "sw.js" && !/\/bgm_[a-z_]+\.(ogg|m4a)$/.test(f) && !f.endsWith(".map"));
      const precache = ["./", ...all.map((f) => `./${f}`)];
      const version = createHash("sha1").update(all.map((f) => `${f}:${statSync(join(dist, f)).size}`).join("|")).digest("hex").slice(0, 10);
      const sw = readFileSync(join(here, "src/sw.template.js"), "utf8").replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(precache));
      writeFileSync(join(dist, "sw.js"), sw);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [kiln()],
  server: { host: "127.0.0.1", port: 5273, strictPort: true },
  preview: { host: "127.0.0.1", port: 5274, strictPort: true },
  build: { assetsDir: "js", target: "es2022", sourcemap: false, chunkSizeWarningLimit: 2000 },
});
