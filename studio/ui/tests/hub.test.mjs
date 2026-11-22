// The Projects screen's shell side: the route, the enabled switcher, and complete English and Vietnamese strings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHash, formatHash } from '../router.mjs';

const read = rel => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const table = (dir, lang) => JSON.parse(read(`${dir}/i18n/${lang}.json`));

test('PROJECTS-014: the project switcher opens the Projects screen, which is its own route and has every string in en and vi', () => {
  assert.equal(parseHash('#/projects').tab, 'projects');
  assert.equal(formatHash({tab: 'projects'}), '#/projects');
  assert.equal(parseHash('#/projects/some-asset').asset, null, 'the screen takes no asset');
  const shell = read('shell.js');
  assert.doesNotMatch(shell, /switcherSoon|aria-disabled/, 'the switcher is no longer disabled');
  assert.match(shell, /class: 'switcher'[^]*?navigate\(\{tab: hubTab\}\)/, 'the switcher navigates to the hub');
  // Every key the hub and the shell ask for exists in both languages (a computed key like 'hub.err.' + code is covered by the error list).
  const hubKeys = new Set([...read('hub/index.mjs').matchAll(/\bt\('([a-z][\w.-]*)'/g)].map(m => m[1]).filter(k => !k.endsWith('.')));
  for (const lang of ['en', 'vi']) {
    const hub = table('hub', lang), shellTable = table('', lang);
    for (const key of hubKeys) assert.ok(key in hub || key in shellTable, `${lang}: ${key}`);
    for (const code of ['not_found', 'not_a_directory', 'no_pack', 'invalid_pack', 'path_not_absolute', 'invalid_path', 'dir_not_empty', 'parent_missing', 'stale_pack', 'owner_decision_required', 'unknown_project'])
      assert.ok(`hub.err.${code}` in hub, `${lang}: hub.err.${code}`);
    for (const tpl of ['blank', 'moss-lantern']) assert.ok(`hub.tpl.${tpl}` in hub && `hub.tpl.${tpl}.about` in hub);
    assert.ok('nav.projects' in shellTable && 'top.noProject' in shellTable && 'top.switcher' in shellTable);
  }
});
