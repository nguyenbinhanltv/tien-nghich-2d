#!/usr/bin/env node
/**
 * Smoke test of the studio itself for one project: the shell and its modules are served, the pack
 * answers, and every mount, alias and page rewrite the pack declares resolves.
 *
 *   node studio/smoke-test.mjs [--project <dir>]
 * (A project's own pages may carry their own smoke test.)
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createPreviewServer } from './serve.mjs';
import { loadPackSync } from './core/pack.mjs';

const at = process.argv.indexOf('--project'), joined = process.argv.find(a => a.startsWith('--project='));
const root = path.resolve(joined ? joined.slice('--project='.length) : at > 0 ? process.argv[at + 1] : new URL('..', import.meta.url).pathname);
const pack = loadPackSync(root, undefined, { verifyFiles: false });
const server = createPreviewServer({ root });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const get = async (url, status = 200) => {
  const res = await fetch(origin + url);
  assert.equal(res.status, status, `${url}: expected ${status}, got ${res.status}`);
  return res;
};
try {
  assert.ok((await (await get('/studio/')).text()).includes('ui/shell.js'), 'shell entry missing');
  for (const rel of ['/studio/ui/shell.js', '/studio/ui/router.mjs', '/studio/ui/i18n/en.json', '/studio/ui/i18n/vi.json', '/studio/ui/tabs/overview/index.mjs']) await get(rel);
  const info = await (await get('/api/studio/project')).json();
  assert.equal(info.id ?? info.pack?.id ?? pack.id, pack.id);
  await get('/api/studio/overview');
  for (const alias of pack.serve?.aliases ?? []) assert.equal(await (await get(`${alias.from}/`)).text(), await (await get(`${alias.to}/`)).text(), `${alias.from} must alias ${alias.to}`);
  for (const page of pack.serve?.pages ?? []) {
    const [k, [v]] = Object.entries(page.query)[0];
    assert.equal(await (await get(`${page.path}?${k}=${v}`)).text(), await (await get(page.serve)).text(), `${page.path}?${k}=${v} must serve ${page.serve}`);
  }
  for (const hook of pack.serve?.hooks ?? []) await get(hook.path);
  await get('/studio/no-such-file.js', 404);
  console.log(`SMOKE TEST PASSED: ${pack.name} (${pack.id})`);
} finally { server.close(); }
