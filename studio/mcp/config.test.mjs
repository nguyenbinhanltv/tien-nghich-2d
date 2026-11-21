// Guards the project-scoped harness configs: relative paths (so each git worktree runs its own copy),
// nothing machine-specific, and a server entry that really starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioClient } from './stdio_client.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function jsonEntry(rel) {
  const entry = JSON.parse(read(rel)).mcpServers.studio;
  return { command: entry.command, args: entry.args, keys: Object.keys(entry) };
}
function tomlEntry(rel) {
  const text = read(rel);
  assert.match(text, /^\[mcp_servers\.studio\]$/m);
  const command = /^command = "([^"]+)"$/m.exec(text)[1];
  const args = JSON.parse(/^args = (\[.*\])$/m.exec(text)[1]);
  return { command, args, keys: [...text.matchAll(/^([a-z_]+) = /gm)].map((m) => m[1]) };
}

const CONFIGS = {
  '.mcp.json': () => jsonEntry('.mcp.json'),
  '.codex/config.toml': () => tomlEntry('.codex/config.toml'),
  '.agents/mcp_config.json': () => jsonEntry('.agents/mcp_config.json'),
};

for (const [file, parse] of Object.entries(CONFIGS)) {
  test(`${file}: relative, portable, and points at a real entry point`, () => {
    const { command, args, keys } = parse();
    assert.equal(command, 'node', 'bare command, resolved from PATH');
    assert.equal(args[0], 'studio/mcp.mjs');
    assert.ok(existsSync(join(ROOT, args[0])), 'script exists relative to the repo root');
    for (const a of args) {
      assert.equal(isAbsolute(a), false, `absolute path in args: ${a}`);
      assert.doesNotMatch(a, /\/Users\/|\/home\/|~|\.\.\//, `machine-specific argument: ${a}`);
    }
    assert.ok(!args.includes('--project'), '--project is omitted: the server defaults to the repo containing the script');
    assert.ok(!keys.includes('cwd'), 'cwd is deliberately unset (undocumented default in Codex/Antigravity; see README)');
    assert.ok(!keys.includes('env'), 'no environment baked in');
  });
}

test('the agent name in each config matches its harness', () => {
  assert.deepEqual(CONFIGS['.codex/config.toml']().args.slice(1), ['--agent', 'codex']);
  assert.deepEqual(CONFIGS['.agents/mcp_config.json']().args.slice(1), ['--agent', 'antigravity']);
  assert.deepEqual(CONFIGS['.mcp.json']().args, ['studio/mcp.mjs'], 'Claude Code identifies itself via clientInfo');
});

test('launching exactly as a config does, from the repo root, serves this checkout', async () => {
  const c = new StdioClient(join(ROOT, 'studio/mcp.mjs'), ['--agent', 'config-test'], { cwd: ROOT });
  try {
    await c.request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
    const r = await c.request(2, 'tools/call', { name: 'studio_project_info', arguments: { sections: ['palette'] } });
    assert.equal(r.result.structuredContent.project.root, ROOT);
    assert.equal(r.result.structuredContent.palette.count, 40);
  } finally { await c.close(); }
});
