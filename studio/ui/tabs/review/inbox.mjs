// The inbox: every frame lineage in the revision store, its head status, and the agent requests in
// its comments. Read-only SQL over the store's own tables (editor.sqlite), opened readOnly so this
// route can never change a review. Statuses use the store's rule: an explicit decision wins, else a revision is
// pending (awaiting review). Revision 0 of a frame nobody decided in the studio may still be approved by a hash-tied
// record or baseline; the SQL cannot see those, so such an item comes back with `explicit: false` and the server
// resolves it with `withStanding`.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseComment } from './model.mjs';

const explicit = `(select status from reviews r where r.key=v.key and r.rev=v.rev and status is not null order by seq desc limit 1)`;
export const stateOf = status => (status === 'pending' ? 'waiting' : status === 'changes_requested' ? 'agent' : 'decided');

export function readInbox(libraryDir, {limitDecided = 60} = {}) {
  const file = path.join(libraryDir, 'editor.sqlite');
  const dirStat = fs.lstatSync(libraryDir, {throwIfNoEntry: false});
  const stat = fs.lstatSync(file, {throwIfNoEntry: false});
  if (!dirStat || dirStat.isSymbolicLink() || !stat || !stat.isFile() || stat.nlink !== 1) return [];
  const db = new DatabaseSync(file, {readOnly: true});
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const heads = db.prepare(`SELECT v.key AS key, v.rev AS head, ${explicit} AS status, (SELECT count(*) FROM reviews r WHERE r.key=v.key) AS reviews,
        (SELECT max(seq) FROM reviews r WHERE r.key=v.key) AS lastSeq
      FROM versions v WHERE v.rev=(SELECT max(rev) FROM versions w WHERE w.key=v.key) ORDER BY v.key`).all();
    const comments = db.prepare(`SELECT text FROM reviews WHERE key=? AND rev=? AND text IS NOT NULL ORDER BY seq`);
    const items = [];
    for (const h of heads) {
      if (h.head === 0 && !h.reviews) continue; // a lineage nobody has judged or discussed is not inbox material
      const status = h.status ?? 'pending', s = stateOf(status);
      const parsed = comments.all(h.key, h.head).map(c => parseComment(c.text));
      const requests = parsed.filter(c => c.kind === 'request').map(c => ({request: c.request, agent: c.agent, session: c.session, note: c.body, questions: c.questions}));
      items.push({key: h.key, assetId: h.key.split('/')[1] ?? h.key, head: h.head, status, explicit: h.status !== null, state: s, requests,
        comments: parsed.length, lastSeq: h.lastSeq ?? 0});
    }
    return finish(items, limitDecided);
  } finally { db.close(); }
}

/** Re-state items whose status is only the store's default, once their standing is known: `standingOf(key)` -> 'approved' | 'baseline' | 'awaiting'. */
export async function withStanding(items, standingOf, limitDecided = 60) {
  const out = [];
  for (const i of items) {
    if (i.head !== 0 || i.explicit) { out.push(i); continue; }
    const standing = await standingOf(i.key);
    const status = standing === 'approved' || standing === 'baseline' ? standing : 'pending';
    out.push({...i, status, state: stateOf(status)});
  }
  return finish(out, limitDecided);
}

function finish(items, limitDecided) {
  const order = {waiting: 0, agent: 1, decided: 2};
  items.sort((a, b) => order[a.state] - order[b.state] || (b.requests.length ? 1 : 0) - (a.requests.length ? 1 : 0) || b.lastSeq - a.lastSeq || (a.key < b.key ? -1 : 1));
  let decided = 0;
  return items.filter(i => i.state !== 'decided' || ++decided <= limitDecided);
}

/** key -> {head, status}: the head revision of every lineage and its explicit human status (null when nobody decided). Read-only. */
export function readHeads(libraryDir) {
  const file = path.join(libraryDir, 'editor.sqlite');
  const dirStat = fs.lstatSync(libraryDir, {throwIfNoEntry: false});
  const stat = fs.lstatSync(file, {throwIfNoEntry: false});
  if (!dirStat || dirStat.isSymbolicLink() || !stat || !stat.isFile() || stat.nlink !== 1) return new Map();
  const db = new DatabaseSync(file, {readOnly: true});
  try {
    db.exec('PRAGMA busy_timeout=5000');
    return new Map(db.prepare(`SELECT v.key AS key, v.rev AS head, ${explicit} AS status FROM versions v
      WHERE v.rev=(SELECT max(rev) FROM versions w WHERE w.key=v.key)`).all().map(r => [r.key, {head: r.head, status: r.status}]));
  } finally { db.close(); }
}
