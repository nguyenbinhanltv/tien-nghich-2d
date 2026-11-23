import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-content/**', 'node_modules/**', 'spike/**'] },
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
  { files: ['tools/**/*.ts', 'tests/**/*.ts'], rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
);
