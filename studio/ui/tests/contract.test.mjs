// Every tab module under studio/ui/tabs/<id>/ must honour the contract in studio/ui/README.md.
// A new tab is covered by adding its directory: this test discovers it, nobody edits it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { destinationIds } from '../destinations.mjs';
import { parseHash } from '../router.mjs';

const tabsDir = new URL('../tabs/', import.meta.url);
const ids = fs.readdirSync(tabsDir, {withFileTypes: true}).filter(e => e.isDirectory()).map(e => e.name);

test('tab directories are destinations (plus the shell-owned placeholder)', () => {
  for (const id of ids) assert.ok(id === '_placeholder' || destinationIds.includes(id), `${id} is not one of the nine destinations`);
  assert.ok(ids.includes('overview'));
});

for (const id of ids) {
  test(`tab "${id}" exports the contract`, async () => {
    const mod = await import(pathToFileURL(new URL(id + '/index.mjs', tabsDir).pathname).href);
    assert.equal(typeof mod.mount, 'function', 'mount(ctx, state)');
    assert.equal(typeof mod.parseRoute, 'function', 'parseRoute(route)');
    for (const optional of ['unmount', 'update']) assert.ok(mod[optional] === undefined || typeof mod[optional] === 'function', optional);
    // parseRoute is pure and total: any parsed URL yields a state without throwing.
    for (const hash of ['', `#/${id}`, `#/${id}/some_asset?clip=idle&dir=south&frame=2&junk=1`])
      assert.doesNotThrow(() => mod.parseRoute(parseHash(hash)), hash);
    if (id !== '_placeholder') {
      for (const lang of ['en', 'vi']) {
        const file = new URL(`${id}/i18n/${lang}.json`, tabsDir);
        assert.ok(fs.existsSync(file), `missing i18n/${lang}.json`);
        JSON.parse(fs.readFileSync(file));
      }
    }
  });
}
