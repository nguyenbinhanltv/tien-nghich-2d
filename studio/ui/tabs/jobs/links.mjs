// Which assets and review items a (agent, session) pair has touched, from records that already exist:
// the submission logs next to each asset's raw frames, the QA check records in studio.sqlite, and the
// agent tags in the review comments of the revision store. All reads are read-only.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readSubmissions, SUBMISSIONS_FILE } from '../../../core/submissions.mjs';

const tag = /^\[agent (?<agent>.+?) · (?<session>[0-9a-f]{1,16})\] /;
const cap = 10;

function readonly(file) {
  const dir = path.dirname(file);
  const d = fs.lstatSync(dir, {throwIfNoEntry: false}), f = fs.lstatSync(file, {throwIfNoEntry: false});
  if (!d || d.isSymbolicLink() || !f || !f.isFile() || f.nlink !== 1) return null;
  const db = new DatabaseSync(file, {readOnly: true});
  db.exec('PRAGMA busy_timeout=2000');
  return db;
}

/** Review items (frame keys) whose comments carry this agent and session prefix, newest first. */
export function reviewKeys(libraryDir, pairs) {
  const db = readonly(path.join(libraryDir, 'editor.sqlite'));
  const out = new Map(pairs.map(p => [p.id, []]));
  if (!db) return out;
  try {
    for (const row of db.prepare("SELECT key, rev, text FROM reviews WHERE text LIKE '[agent %' ORDER BY seq DESC LIMIT 3000").all()) {
      const t = tag.exec(row.text);
      if (!t) continue;
      for (const p of pairs) {
        if (t.groups.agent !== p.agent || !(p.session.startsWith(t.groups.session) || t.groups.session.startsWith(p.session))) continue;
        const list = out.get(p.id);
        if (list.length < cap && !list.some(x => x.key === row.key)) list.push({key: row.key, assetId: row.key.split('/')[1] ?? row.key, revision: row.rev});
      }
    }
  } finally { db.close(); }
  return out;
}

/** Assets this pair submitted frames for or ran a recorded QA check on. */
export async function touchedAssets(root, libraryDir, index, pairs) {
  const out = new Map(pairs.map(p => [p.id, new Map()]));
  const add = (p, id, via) => { const m = out.get(p.id); if (m.size < cap && !m.has(id) && index.assets.has(id)) m.set(id, {id, category: index.assets.get(id).category, via}); };
  const matches = (p, agent, session) => agent === p.agent && (String(session).startsWith(p.session) || p.session.startsWith(String(session).slice(0, 8)));
  for (const asset of index.assets.values()) {
    if (!asset.layout?.rawDir || !fs.existsSync(path.join(root, asset.layout.rawDir, SUBMISSIONS_FILE))) continue;
    for (const r of await readSubmissions(root, asset).catch(() => [])) for (const p of pairs) if (matches(p, r.agent, r.session)) add(p, asset.id, 'submitted');
  }
  const db = readonly(path.join(libraryDir, 'studio.sqlite'));
  if (db) try {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='checks'").get())
      for (const r of db.prepare('SELECT asset, agent, session FROM checks ORDER BY seq DESC LIMIT 1000').all()) for (const p of pairs) if (matches(p, r.agent, r.session)) add(p, r.asset, 'checked');
  } finally { db.close(); }
  return new Map([...out].map(([id, m]) => [id, [...m.values()]]));
}
