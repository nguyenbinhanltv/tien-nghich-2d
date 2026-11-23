import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-content/**', 'node_modules/**', 'spike/**', 'pwa/sw.template.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Layering rule (docs/GAME_PLAN.md): the simulation is pure TypeScript and never sees the renderer, the DOM or an engine.
    files: ['src/sim/**/*.ts', 'src/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['**/render/**', 'phaser', 'phaser/*', 'pixi.js', 'pixi.js/*'] }],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'requestAnimationFrame', 'performance', 'Math.random'],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the seeded Rng from sim/rng.ts.' }, { object: 'Date', property: 'now', message: 'The sim has no wall clock; time is ticks.' }],
    },
  },
  { files: ['audio-check/**/*.mjs'], languageOptions: { globals: Object.fromEntries(['process', 'console', 'fetch', 'OffscreenCanvas', 'OfflineAudioContext', 'setTimeout'].map((g) => [g, 'readonly'])) } },
  { files: ['tools/**/*.ts', 'tests/**/*.ts', 'pwa/**/*.ts'], rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
);
