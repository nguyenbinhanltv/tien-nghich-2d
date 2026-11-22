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
        CREATE INDEX IF NOT EXISTS cycles_by_asset ON cycles(asset, seq);
        CREATE TABLE IF NOT EXISTS cand_runs(run TEXT PRIMARY KEY, ts TEXT NOT NULL, asset TEXT NOT NULL, agent TEXT NOT NULL, session TEXT NOT NULL,
          note TEXT, reference TEXT, generations INTEGER NOT NULL DEFAULT 0, tool TEXT);
        CREATE TABLE IF NOT EXISTS cands(seq INTEGER PRIMARY KEY, run TEXT NOT NULL REFERENCES cand_runs(run), label TEXT NOT NULL,
          verdict TEXT NOT NULL CHECK(verdict IN ('survivor','rejected')), reason TEXT, revisions TEXT, qa TEXT);
        CREATE INDEX IF NOT EXISTS cands_by_run ON cands(run, seq);
        CREATE TABLE IF NOT EXISTS cand_picks(seq INTEGER PRIMARY KEY, ts TEXT NOT NULL, run TEXT NOT NULL, label TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS change_requests(seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, ts TEXT NOT NULL, asset TEXT NOT NULL, key TEXT NOT NULL,
          rev INTEGER NOT NULL, hash TEXT NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL, w INTEGER NOT NULL, h INTEGER NOT NULL, text TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS change_requests_by_frame ON change_requests(key, seq);
        CREATE TRIGGER IF NOT EXISTS change_requests_no_update BEFORE UPDATE ON change_requests BEGIN SELECT RAISE(ABORT, 'change requests are append-only'); END;
        CREATE TRIGGER IF NOT EXISTS change_requests_no_delete BEFORE DELETE ON change_requests BEGIN SELECT RAISE(ABORT, 'change requests are append-only'); END;
        CREATE TABLE IF NOT EXISTS cr_answers(seq INTEGER PRIMARY KEY, ts TEXT NOT NULL, cr TEXT NOT NULL REFERENCES change_requests(id), key TEXT NOT NULL,
          rev INTEGER NOT NULL, agent TEXT NOT NULL, session TEXT NOT NULL, text TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS cr_answers_by_cr ON cr_answers(cr, seq);`);
      // Older databases lack the evidence columns: add them once.
      for (const table of ['checks', 'events']) {
        if (!connection.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'evidence')) connection.exec(`ALTER TABLE ${table} ADD COLUMN evidence TEXT`);
      }
      // What runs cost in generations and wall time (quota.mjs). The studio knows no prices.
      connection.exec(`CREATE TABLE IF NOT EXISTS spend(seq INTEGER PRIMARY KEY, ts TEXT NOT NULL, agent TEXT NOT NULL, session TEXT NOT NULL, tool TEXT NOT NULL,
          kind TEXT NOT NULL, generations INTEGER NOT NULL, est_wall_ms INTEGER NOT NULL DEFAULT 0, wall_ms INTEGER, ok INTEGER, asset TEXT);
        CREATE INDEX IF NOT EXISTS spend_by_agent ON spend(agent, seq);`);
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
    /** A run accepted by the quota: recorded when it starts (with its estimate), completed by finishSpend. */
    recordSpend({agent, session, tool, kind, generations, estWallMs = 0, asset = null}) {
      return Number(open(true).prepare('INSERT INTO spend(ts,agent,session,tool,kind,generations,est_wall_ms,asset) VALUES(?,?,?,?,?,?,?,?)').run(now(), agent, session, tool, kind, generations, estWallMs, asset).lastInsertRowid);
    },
    finishSpend(id, {wallMs, ok}) { open(true).prepare('UPDATE spend SET wall_ms=?, ok=? WHERE seq=?').run(Math.round(wallMs), ok ? 1 : 0, id); },
    spend({limit = 5000} = {}) {
      const d = open(false);
      if (!d) return [];
      return d.prepare('SELECT * FROM spend ORDER BY seq DESC LIMIT ?').all(limit).map(r => ({id: r.seq, at: r.ts, agent: r.agent, session: r.session, tool: r.tool, kind: r.kind, generations: r.generations,
        estWallMs: r.est_wall_ms, wallMs: r.wall_ms ?? 0, ok: r.ok === null ? null : !!r.ok, asset: r.asset}));
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
    /** A candidate run: several candidates for one asset. Survivors carry {key: revision}; a rejected one carries the reason and its QA numbers. */
    addCandidateRun({run, asset, agent, session, note = null, reference = null, generations = 0, tool = null, candidates}) {
      const d = open(true);
      d.exec('BEGIN IMMEDIATE');
      try {
        d.prepare('INSERT INTO cand_runs(run,ts,asset,agent,session,note,reference,generations,tool) VALUES(?,?,?,?,?,?,?,?,?)').run(run, now(), asset, agent, session, note, reference, generations, tool);
        for (const c of candidates) d.prepare('INSERT INTO cands(run,label,verdict,reason,revisions,qa) VALUES(?,?,?,?,?,?)')
          .run(run, c.label, c.verdict, c.reason ?? null, c.revisions ? JSON.stringify(c.revisions) : null, c.qa ? JSON.stringify(c.qa) : null);
        d.exec('COMMIT');
      } catch (error) { d.exec('ROLLBACK'); throw error; }
    },
    candidateRuns({asset, run, limit = 20} = {}) {
      const d = open(false);
      if (!d) return [];
      const rows = run ? d.prepare('SELECT * FROM cand_runs WHERE run=?').all(run)
        : asset ? d.prepare('SELECT * FROM cand_runs WHERE asset=? ORDER BY ts DESC, rowid DESC LIMIT ?').all(asset, limit)
        : d.prepare('SELECT * FROM cand_runs ORDER BY ts DESC, rowid DESC LIMIT ?').all(limit);
      return rows.map(r => {
        const picks = d.prepare('SELECT ts,label FROM cand_picks WHERE run=? ORDER BY seq DESC').all(r.run);
        return {run: r.run, at: r.ts, asset: r.asset, agent: r.agent, session: r.session, note: r.note, reference: r.reference, generations: r.generations, tool: r.tool,
          picked: picks[0] ? {label: picks[0].label, at: picks[0].ts} : null,
          candidates: d.prepare('SELECT label,verdict,reason,revisions,qa FROM cands WHERE run=? ORDER BY seq').all(r.run)
            .map(c => ({label: c.label, verdict: c.verdict, reason: c.reason, revisions: c.revisions ? JSON.parse(c.revisions) : null, qa: c.qa ? JSON.parse(c.qa) : null}))};
      });
    },
    recordPick({run, label}) { open(true).prepare('INSERT INTO cand_picks(ts,run,label) VALUES(?,?,?)').run(now(), run, label); },
    /** A human's note pinned to a revision (by hash), a frame (key) and a box. Append-only: no update, no delete (triggers enforce it). */
    addChangeRequest({id, asset, key, rev, hash, x, y, w, h, text}) {
      open(true).prepare('INSERT INTO change_requests(id,ts,asset,key,rev,hash,x,y,w,h,text) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, now(), asset, key, rev, hash, x, y, w, h, text);
    },
    changeRequests(key) {
      const d = open(false);
      if (!d) return [];
      return d.prepare('SELECT * FROM change_requests WHERE key=? ORDER BY seq').all(key).map(r => ({id: r.id, at: r.ts, asset: r.asset, key: r.key, revision: r.rev, hash: r.hash,
        box: {x: r.x, y: r.y, w: r.w, h: r.h}, text: r.text,
        answers: d.prepare('SELECT ts,rev,agent,session,text FROM cr_answers WHERE cr=? ORDER BY seq').all(r.id).map(a => ({at: a.ts, revision: a.rev, agent: a.agent, session: a.session, text: a.text}))}));
    },
    addAnswer({cr, key, rev, agent, session, text}) {
      open(true).prepare('INSERT INTO cr_answers(ts,cr,key,rev,agent,session,text) VALUES(?,?,?,?,?,?,?)').run(now(), cr, key, rev, agent, session, text);
    },
    close() { db?.close(); db = undefined; },
  };
}
