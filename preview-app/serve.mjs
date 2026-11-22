#!/usr/bin/env node
// Compatibility shim: the app moved to studio/. `node preview-app/serve.mjs` keeps working.
import { fileURLToPath } from 'node:url';
import { runCli } from '../studio/serve.mjs';

export { createPreviewServer } from '../studio/serve.mjs';
import { fileURLToPath as toPath } from 'node:url';
import { loadPackSync } from '../studio/core/pack.mjs';
import { buildPreviewIndex as buildIndex } from '../playables/preview-index.mjs';

const repoRoot = toPath(new URL('../', import.meta.url));
/** Compatibility: the zero-argument form builds the index of the bundled project; {root, pack} may be passed. */
export const buildPreviewIndex = ({ root = repoRoot, pack } = {}) => buildIndex({ root, pack: pack ?? loadPackSync(root, undefined, { verifyFiles: false }) });

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) runCli();
