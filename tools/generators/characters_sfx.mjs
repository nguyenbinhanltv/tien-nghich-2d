// Render the three Characters one-shots with the Studio audio engine. Each patch carries a gameplay `window` (idea F9):
// resolveWindow sizes it, then the engine renders PCM16 mono. Writes <out>/<id>.wav and <out>/windows.json.
// Usage: node tools/generators/characters_sfx.mjs --out <empty-directory>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDocument } from '../../studio/audio/render.mjs';
import { resolveWindow } from '../../studio/audio/window.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(root, 'assets/audio/source/characters_sfx');
const IDS = ['sfx_keeper_call', 'sfx_pet_reply', 'sfx_form_shift'];
const out = process.argv[process.argv.indexOf('--out') + 1];
if (!out || process.argv.indexOf('--out') < 0) { console.error('usage: --out <empty-directory>'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
if (fs.readdirSync(out).length) { console.error('choose an empty output directory'); process.exit(2); }

const windows = {};
for (const id of IDS) {
  const patch = JSON.parse(fs.readFileSync(path.join(source, `${id}.patch.json`), 'utf8'));
  const { document, window } = resolveWindow(patch);
  const render = renderDocument(document);
  fs.writeFileSync(path.join(out, `${id}.wav`), render.wav);
  windows[id] = window;
}
fs.writeFileSync(path.join(out, 'windows.json'), `${JSON.stringify(windows, null, 2)}\n`);
