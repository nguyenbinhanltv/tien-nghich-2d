import { defineConfig } from 'vitest/config';
import { pwa } from './pwa/vite-plugin.ts';

// The game is a static page. dist/ is the web build; the same build is what Capacitor wraps later.
// Dev and preview bind to loopback unless TN2D_HOST is set; `npm run dev:lan` sets it to this machine's private
// address (pwa/lan.ts) and the plugin refuses clients outside the local network.
const host = process.env['TN2D_HOST'] ?? '127.0.0.1';
export default defineConfig({
  base: './',
  plugins: [pwa()],
  server: { host, port: 5173, strictPort: true },
  preview: { host, port: 4173, strictPort: true },
  build: { target: 'es2023', sourcemap: false, chunkSizeWarningLimit: 2000 },
  test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts', 'pwa/**/*.test.ts'], environment: 'node' },
});
