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
        CREATE INDEX IF NOT EXISTS events_by_frame ON events(key, rev, seq);
        CREATE TABLE IF NOT EXISTS looks(seq INTEGER PRIMARY KEY, ts TEXT NOT NULL, asset TEXT NOT NULL, session TEXT NOT NULL,
          content TEXT NOT NULL, image TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS looks_by_asset ON looks(asset, session, seq);
        CREATE TABLE IF NOT EXISTS rounds(seq INTEGER PRIMARY KEY, ts TEXT NOT NULL, asset TEXT NOT NULL, stage TEXT NOT NULL, content TEXT NOT NULL,
          session TEXT NOT NULL, agent TEXT NOT NULL, errors INTEGER NOT NULL, warnings INTEGER NOT NULL, round INTEGER NOT NULL,
          progress INTEGER NOT NULL, decision TEXT NOT NULL, reason TEXT, cycle INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS rounds_by_asset ON rounds(asset, seq);
        CREATE TABLE IF NOT EXISTS cycles(seq INTEGER PRIMARY KEY, ts TEXT NOT NULL, asset TEXT NOT NULL, kind TEXT NOT NULL, session TEXT NOT NULL, note TEXT);
        CREATE INDEX IF NOT EXISTS cycles_by_asset ON cycles(asset, seq);`);
      // Older databases lack the evidence columns: add them once.
      for (const table of ['checks', 'events']) {
        if (!connection.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'evidence')) connection.exec(`ALTER TABLE ${table} ADD COLUMN evidence TEXT`);
      }
      try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
      db = connection;
      return db;
    } catch (error) { connection.close(); throw error; }
  }
  const now = () => new Date().toISOString();
  return {
    recordCheck({asset, stage, content, session, agent, independent, pass, errors, warnings, evidence = null}) {
      const d = open(true);
      d.prepare('INSERT INTO checks(ts,asset,stage,content,session,agent,independent,pass,errors,warnings,evidence) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(now(), asset, stage, content, session, agent, independent ? 1 : 0, pass ? 1 : 0, errors, warnings, evidence ? JSON.stringify(evidence) : null);
    },
    checks(asset, limit = 20) {
      const d = open(false);
      if (!d) return [];
      return d.prepare('SELECT ts,stage,content,session,agent,independent,pass,errors,warnings,evidence FROM checks WHERE asset=? ORDER BY seq DESC LIMIT ?')
        .all(asset, limit).map(r => ({...r, independent: !!r.independent, pass: !!r.pass, evidence: r.evidence ? JSON.parse(r.evidence) : null}));
    },
    addEvent({request, key, rev, kind, agent, session, text, replyTo = null, resolves = false, evidence = null}) {
      const d = open(true);
      const r = d.prepare('INSERT INTO events(ts,request,key,rev,kind,agent,session,text,reply_to,resolves,evidence) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(now(), request, key, rev, kind, agent, session, text, replyTo, resolves ? 1 : 0, evidence ? JSON.stringify(evidence) : null);
      return Number(r.lastInsertRowid);
    },
    events(key, rev) {
      const d = open(false);
      if (!d) return [];
      const rows = rev === undefined
        ? d.prepare('SELECT * FROM events WHERE key=? ORDER BY seq').all(key)
        : d.prepare('SELECT * FROM events WHERE key=? AND rev=? ORDER BY seq').all(key, rev);
      return rows.map(r => ({seq: r.seq, ts: r.ts, request: r.request, key: r.key, revision: r.rev, kind: r.kind, agent: r.agent,
        session: r.session, text: r.text, replyTo: r.reply_to, resolves: !!r.resolves, evidence: r.evidence ? JSON.parse(r.evidence) : null}));
    },
    /** A contact sheet (or other picture) a session looked at, tied to the frames it showed. */
    recordLook({asset, session, content, image}) {
      open(true).prepare('INSERT INTO looks(ts,asset,session,content,image) VALUES(?,?,?,?,?)').run(now(), asset, session, content, image);
    },
    lastLook(asset, session) {
      const d = open(false);
      return d ? d.prepare('SELECT ts,content,image FROM looks WHERE asset=? AND session=? ORDER BY seq DESC LIMIT 1').get(asset, session) ?? null : null;
    },
    /** Fix rounds (stop policy): one row per distinct-content measurement of an asset. */
    recordRound({asset, stage, content, session, agent, errors, warnings, round, progress, decision, reason = null, cycle = 0}) {
      open(true).prepare('INSERT INTO rounds(ts,asset,stage,content,session,agent,errors,warnings,round,progress,decision,reason,cycle) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(now(), asset, stage, content, session, agent, errors, warnings, round, progress ? 1 : 0, decision, reason, cycle);
    },
    rounds(asset, cycle = 0) {
      const d = open(false);
      return d ? d.prepare('SELECT * FROM rounds WHERE asset=? AND cycle=? ORDER BY seq').all(asset, cycle).map(r => ({...r, progress: !!r.progress})) : [];
    },
    /** A cycle boundary: a review request (or an escalation) starts a new count of fix rounds. */
    recordCycle({asset, kind, session, note = null}) {
      const d = open(true);
      return Number(d.prepare('INSERT INTO cycles(ts,asset,kind,session,note) VALUES(?,?,?,?,?)').run(now(), asset, kind, session, note).lastInsertRowid);
    },
    lastCycle(asset) {
      const d = open(false);
      return d ? d.prepare('SELECT seq,ts,kind,note FROM cycles WHERE asset=? ORDER BY seq DESC LIMIT 1').get(asset) ?? null : null;
    },
    close() { db?.close(); db = undefined; },
  };
}
