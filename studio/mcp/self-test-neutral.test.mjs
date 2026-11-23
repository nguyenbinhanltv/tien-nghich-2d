// `--self-test` must work on any project, not only the repository it ships in: run it on the sample project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mcp = fileURLToPath(new URL('../mcp.mjs', import.meta.url));
const sample = fileURLToPath(new URL('../examples/moss-lantern/', import.meta.url));

test('mcp --self-test passes on examples/moss-lantern', () => {
  const r = spawnSync(process.execPath, [mcp, '--self-test', '--project', sample], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!/^FAIL/m.test(r.stderr), r.stderr);
  assert.match(r.stderr, /self-test PASSED \(\d+ checks\)/);
  assert.match(r.stderr, /returns the project palette {2}\(12 colours\)/);
  assert.ok(!/\b43\b/.test(r.stderr), 'no first-project palette size in the report');
});
