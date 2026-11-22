// The inbox: every frame lineage in the revision store, its head status, and the agent requests in
// its comments. Read-only SQL over the store's own tables (editor.sqlite), opened readOnly so this
// route can never change a review. Statuses use the store's rule: an explicit decision wins, else
// revision 0 is approved and any later revision is pending.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseComment } from './model.mjs';

const state = `coalesce((select status from reviews r where r.key=v.key and r.rev=v.rev and status is not null order by seq desc limit 1),
  case v.rev when 0 then 'approved' else 'pending' end)`;
const stateOf = status => (status === 'pending' ? 'waiting' : status === 'changes_requested' ? 'agent' : 'decided');

export function readInbox(libraryDir, {limitDecided = 60} = {}) {
  const file = path.join(libraryDir, 'editor.sqlite');
  const dirStat = fs.lstatSync(libraryDir, {throwIfNoEntry: false});
  const stat = fs.lstatSync(file, {throwIfNoEntry: false});
  if (!dirStat || dirStat.isSymbolicLink() || !stat || !stat.isFile() || stat.nlink !== 1) return [];
  const db = new DatabaseSync(file, {readOnly: true});
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const heads = db.prepare(`SELECT v.key AS key, v.rev AS head, ${state} AS status, (SELECT count(*) FROM reviews r WHERE r.key=v.key) AS reviews,
        (SELECT max(seq) FROM reviews r WHERE r.key=v.key) AS lastSeq
      FROM versions v WHERE v.rev=(SELECT max(rev) FROM versions w WHERE w.key=v.key) ORDER BY v.key`).all();
    const comments = db.prepare(`SELECT text FROM reviews WHERE key=? AND rev=? AND text IS NOT NULL ORDER BY seq`);
    const items = [];
    for (const h of heads) {
      const s = stateOf(h.status);
      if (s === 'decided' && !h.reviews) continue; // a lineage nobody has judged or discussed is not inbox material
      const parsed = comments.all(h.key, h.head).map(c => parseComment(c.text));
      const requests = parsed.filter(c => c.kind === 'request').map(c => ({request: c.request, agent: c.agent, session: c.session, note: c.body, questions: c.questions}));
      items.push({key: h.key, assetId: h.key.split('/')[1] ?? h.key, head: h.head, status: h.status, state: s, requests,
        comments: parsed.length, lastSeq: h.lastSeq ?? 0});
    }
    const order = {waiting: 0, agent: 1, decided: 2};
    items.sort((a, b) => order[a.state] - order[b.state] || (b.requests.length ? 1 : 0) - (a.requests.length ? 1 : 0) || b.lastSeq - a.lastSeq || (a.key < b.key ? -1 : 1));
    let decided = 0;
    return items.filter(i => i.state !== 'decided' || ++decided <= limitDecided);
  } finally { db.close(); }
}
