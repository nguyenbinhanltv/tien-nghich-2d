// B3 guard: every asset of the Objects tab has a thumbnail whose image URL really answers 200 with a PNG,
// the frame is a representative one (not blank, not a debris/helper clip), and the browser needs no per-card fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from '../../../serve.mjs';
import { decodePng } from '../../../forge/image.mjs';
import { imgUrl } from './dom.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
let server, base;
test.before(async () => {
  server = createPreviewServer();
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => new Promise(ok => server.close(ok)));

test('every Objects asset has a thumbnail URL that returns 200 with a non-empty PNG', async () => {
  const {covers} = await (await fetch(base + '/api/tabs/objects/covers')).json();
  const catalog = (await (await fetch(base + '/api/studio/assets?limit=1000')).json()).assets;
  const tabs = JSON.parse((await import('node:fs')).readFileSync(root + 'studio.project.json', 'utf8')).ui.categoryTabs;
  const inTab = catalog.filter(a => tabs[a.category] === 'objects');
  assert.ok(inTab.length > 100, 'the tab has its assets');
  assert.equal(covers.length, inTab.length, 'one cover entry per asset in the tab');
  const bad = [];
  for (const asset of inTab) {
    const c = covers.find(x => x.id === asset.id && x.source === asset.source);
    if (!c || !c.path) { bad.push(asset.id + ': no cover path'); continue; }
    if (/(debris|broken|shatter|shadow|deco)/.test(c.path.split('/').pop()) && asset.readiness !== 'planned') bad.push(asset.id + ': helper clip ' + c.path);
    const res = await fetch(base + imgUrl(c.path));
    if (res.status !== 200) { bad.push(`${asset.id}: HTTP ${res.status}`); continue; }
    if (!/^image\/png/.test(res.headers.get('content-type') ?? '')) { bad.push(`${asset.id}: content-type ${res.headers.get('content-type')}`); continue; }
    const png = decodePng(Buffer.from(await res.arrayBuffer()));
    let opaque = 0;
    for (let i = 3; i < png.pixels.length; i += 4) if (png.pixels[i] > 0) opaque++;
    if (opaque === 0) bad.push(asset.id + ': fully transparent frame');
  }
  assert.deepEqual(bad, []);
});
