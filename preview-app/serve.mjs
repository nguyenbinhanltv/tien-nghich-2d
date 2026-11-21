#!/usr/bin/env node
// Compatibility shim: the app moved to studio/. `node preview-app/serve.mjs` keeps working.
import { fileURLToPath } from 'node:url';
import { runCli } from '../studio/serve.mjs';

export { buildPreviewIndex, createPreviewServer } from '../studio/serve.mjs';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) runCli();
