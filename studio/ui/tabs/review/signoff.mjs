// Listening sign-offs: the human's record that they listened to one exact master. The core store has
// no such record (it covers pixels), so this tab keeps its own table in the Studio database file,
// next to the agent traffic. Only the Review tab's POST route writes it; no MCP tool can, and a
// sign-off is tied to the sha256 of the master it was given for, so a changed master reads as unsigned.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const verdicts = ['signed', 'needs_work'];

export function openSignoffs(dir) {
  const file = path.join(dir, 'studio.sqlite');
  let db;
  function open(write) {
    if (!fs.lstatSync(dir, {throwIfNoEntry: false})) {
      if (!write) return null;
      fs.mkdirSync(dir, {mode: 0o700, recursive: true});
    }
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('Linked studio directory');
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      const stat = fs.lstatSync(file + suffix, {throwIfNoEntry: false});
      if (stat && (!stat.isFile() || stat.nlink !== 1)) throw new Error('Invalid studio database file');
    }
    if (db) return db;
    if (!write && !fs.existsSync(file)) return null;
    const connection = new DatabaseSync(file);
    try {
      connection.exec(`PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS listening_signoffs(seq INTEGER PRIMARY KEY, ts TEXT NOT NULL, asset TEXT NOT NULL, content TEXT NOT NULL,
          verdict TEXT NOT NULL CHECK(verdict IN ('signed','needs_work')), note TEXT NOT NULL DEFAULT '');
        CREATE INDEX IF NOT EXISTS signoffs_by_asset ON listening_signoffs(asset, seq);`);
      try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
      return (db = connection);
    } catch (error) { connection.close(); throw error; }
  }
  const hasTable = d => !!d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='listening_signoffs'").get();
  return {
    record({asset, content, verdict, note = ''}) {
      if (!verdicts.includes(verdict)) throw new Error('invalid verdict');
      const d = open(true);
      d.prepare('INSERT INTO listening_signoffs(ts,asset,content,verdict,note) VALUES(?,?,?,?,?)').run(new Date().toISOString(), asset, content, verdict, String(note).slice(0, 1000));
    },
    history(asset, limit = 10) {
      const d = open(false);
      if (!d || !hasTable(d)) return [];
      return d.prepare('SELECT ts,content,verdict,note FROM listening_signoffs WHERE asset=? ORDER BY seq DESC LIMIT ?').all(asset, limit);
    },
    /** Latest verdict per asset, for the inbox: {asset: {ts, content, verdict}}. */
    latest() {
      const d = open(false);
      if (!d || !hasTable(d)) return {};
      const rows = d.prepare('SELECT asset,ts,content,verdict FROM listening_signoffs WHERE seq IN (SELECT max(seq) FROM listening_signoffs GROUP BY asset)').all();
      return Object.fromEntries(rows.map(r => [r.asset, {ts: r.ts, content: r.content, verdict: r.verdict}]));
    },
    close() { db?.close(); db = undefined; }
  };
}
