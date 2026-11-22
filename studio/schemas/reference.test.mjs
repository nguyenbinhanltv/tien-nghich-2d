// CLI-008: the pack reference in studio/README.md is the one the schema produces, so it cannot drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { README_FILE, SCHEMA_FILE, renderReference, withReference } from './reference.mjs';

const schema = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
const readme = fs.readFileSync(README_FILE, 'utf8');

test('CLI-008: studio/README.md carries the pack reference exactly as the schema produces it', () => {
  assert.equal(withReference(readme, schema), readme, 'out of date: run node studio/schemas/reference.mjs --write');
});

test('CLI-008: every top-level block of the schema is documented, with a description, and every block the real and sample packs use is in the schema', () => {
  const text = renderReference(schema);
  for (const [name, node] of Object.entries(schema.properties)) {
    if (name === '$schema') continue;
    assert.ok(text.includes(`| \`${name}\` |`), `${name} is missing from the reference`);
    if (!['schema', 'version'].includes(name)) assert.ok(node.description, `${name} has no description in the schema, so the reference cannot explain it`);
  }
  const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (const file of ['studio.project.json', 'studio/examples/moss-lantern/studio.project.json']) {
    const pack = JSON.parse(fs.readFileSync(path.join(repo, file), 'utf8'));
    for (const key of Object.keys(pack)) assert.ok(key in schema.properties, `${file}: ${key} is not a documented block`);
  }
});

test('CLI-008: the README names no command, flag or file the CLI does not have', () => {
  const cli = fs.readFileSync(new URL('../cli.mjs', import.meta.url), 'utf8');
  for (const command of ['init', 'serve', 'mcp', 'check', 'doctor', 'baseline']) assert.ok(cli.includes(`case '${command}'`), command);
  const studio = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const m of readme.matchAll(/\]\(((?!https?:|#|\.\.\/\.\.)[^)#]+)(?:#[^)]*)?\)/g)) assert.ok(fs.existsSync(path.join(studio, m[1])), `README link ${m[1]} does not exist`);
});
