// Print the ledger of this project as JSON. `--base` leaves out the provenance supplements (the input of the project's
// supplement builder); `--index` prints each asset's manifest route instead.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPackSync } from './pack.mjs';
import { loadAssetIndex } from '../mcp/asset-index.mjs';
import { buildLedger } from './ledger.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pack = loadPackSync(root), index = await loadAssetIndex(pack, root);
if (process.argv.includes('--index')) {
  process.stdout.write(JSON.stringify(Object.fromEntries([...index.assets.values()].map(a => [a.id, {assignedAgent: a.assignedAgent ?? null, source: a.source, category: a.category, layout: a.layout?.rawDir ?? null}]))));
} else {
  const base = process.argv.includes('--base');
  const quiet = base ? {...pack, ui: {...pack.ui, tabs: {...pack.ui.tabs, atlas: {...pack.ui.tabs.atlas, ledger: {...pack.ui.tabs.atlas.ledger, provenanceSupplements: []}}}}} : pack;
  process.stdout.write(JSON.stringify(await buildLedger({root, pack: quiet, index})));
}
