// Studio operational state that is not pixels: independent-check records and the structured side of
// agent review traffic. It lives in studio.sqlite beside the revision library (git-ignored), never in
// the revision store's own file, so the two cannot disturb each other's schema or file checks.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openStudioDb(dir) {
  const file = path.join(dir, 'studio.sqlite');
  let db;
  function open(write) {
    if (!fs.lstatSync(dir, {throwIfNoEntry: false})) {
      if (!write) return null;
      fs.mkdirSync(dir, {mode: 0o700, recursive: true});
    }
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('Linked studio directory'); // ancestors may be links (macOS /var); the directory itself may not
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      const stat = fs.lstatSync(file + suffix, {throwIfNoEntry: false});
      if (stat && (!stat.isFile() || stat.nlink !== 1)) throw new Error('Invalid studio database file');
    }
    if (db) return db;
    if (!write && !fs.existsSync(file)) return null;
    const connection = new DatabaseSync(file);
    try {
      connection.exec(`PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS checks(seq INTEGER PRIMARY KEY, ts TEXT NOT NULL, asset TEXT NOT NULL, stage TEXT NOT NULL,
          content TEXT NOT NULL, session TEXT NOT NULL, agent TEXT NOT NULL, independent INTEGER NOT NULL,
          pass INTEGER NOT NULL, errors INTEGER NOT NULL, warnings INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS checks_by_asset ON checks(asset, seq);
        CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY, ts TEXT NOT NULL, request TEXT NOT NULL, key TEXT NOT NULL,
          rev INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('request','reply')), agent TEXT NOT NULL, session TEXT NOT NULL,
          text TEXT NOT NULL, reply_to INTEGER, resolves INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS events_by_frame ON events(key, rev, seq);`);
      try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
      db = connection;
      return db;
    } catch (error) { connection.close(); throw error; }
  }
  const now = () => new Date().toISOString();
  return {
    recordCheck({asset, stage, content, session, agent, independent, pass, errors, warnings}) {
      const d = open(true);
      d.prepare('INSERT INTO checks(ts,asset,stage,content,session,agent,independent,pass,errors,warnings) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(now(), asset, stage, content, session, agent, independent ? 1 : 0, pass ? 1 : 0, errors, warnings);
    },
    checks(asset, limit = 20) {
      const d = open(false);
      if (!d) return [];
      return d.prepare('SELECT ts,stage,content,session,agent,independent,pass,errors,warnings FROM checks WHERE asset=? ORDER BY seq DESC LIMIT ?')
        .all(asset, limit).map(r => ({...r, independent: !!r.independent, pass: !!r.pass}));
    },
    addEvent({request, key, rev, kind, agent, session, text, replyTo = null, resolves = false}) {
      const d = open(true);
      const r = d.prepare('INSERT INTO events(ts,request,key,rev,kind,agent,session,text,reply_to,resolves) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(now(), request, key, rev, kind, agent, session, text, replyTo, resolves ? 1 : 0);
      return Number(r.lastInsertRowid);
    },
    events(key, rev) {
      const d = open(false);
      if (!d) return [];
      const rows = rev === undefined
        ? d.prepare('SELECT * FROM events WHERE key=? ORDER BY seq').all(key)
        : d.prepare('SELECT * FROM events WHERE key=? AND rev=? ORDER BY seq').all(key, rev);
      return rows.map(r => ({seq: r.seq, ts: r.ts, request: r.request, key: r.key, revision: r.rev, kind: r.kind, agent: r.agent,
        session: r.session, text: r.text, replyTo: r.reply_to, resolves: !!r.resolves}));
    },
    close() { db?.close(); db = undefined; },
  };
}
