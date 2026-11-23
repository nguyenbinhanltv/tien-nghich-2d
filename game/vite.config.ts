import { defineConfig } from 'vitest/config';

// The game is a static page. dist/ is the web build; the same build is what Capacitor wraps later.
export default defineConfig({
  base: './',
  build: { target: 'es2023', sourcemap: true },
  test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], environment: 'node' },
});
