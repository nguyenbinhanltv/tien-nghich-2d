// Shared helpers for the measurement scripts. Playwright is NOT a repo dependency:
// point PW_CORE at a playwright-core install (default /tmp/tn2d-spike-tools) and CHROMIUM at a Chromium/Chrome binary.
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const here = dirname(fileURLToPath(import.meta.url));
export const spikeDir = join(here, "..");

export function loadPlaywright() {
  const root = process.env.PW_CORE ?? "/tmp/tn2d-spike-tools/node_modules/playwright-core";
  return createRequire(join(root, "x.js"))(root);
}

export function chromiumPath() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(cache)) {
    const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      const p = join(cache, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
      if (existsSync(p)) return p;
    }
  }
  throw new Error("set CHROMIUM to a Chromium binary");
}

/** Start `vite` (dev, hot reload) or `vite preview` (production bundle) and resolve when it listens. */
export function startVite(mode, env = {}) {
  const args = mode === "dev" ? [] : ["preview"];
  const child = spawn(join(spikeDir, "node_modules/.bin/vite"), args, { cwd: spikeDir, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  process.on('exit', () => child.kill('SIGTERM'));
  const port = mode === "dev" ? 5273 : 5274;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("vite did not start")), 20000);
    const on = (d) => {
      if (String(d).includes(`127.0.0.1:${port}`)) {
        clearTimeout(t);
        resolve({ url: `http://127.0.0.1:${port}/`, stop: () => child.kill("SIGTERM") });
      }
    };
    child.stdout.on("data", on);
    child.stderr.on("data", (d) => process.stderr.write(d));
  });
}

export const pct = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
