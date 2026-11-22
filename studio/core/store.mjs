import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { problem } from './errors.mjs';
import { sameImage } from './standing.mjs';

// A human decision is an explicit review row. Without one, a revision is 'pending' (awaiting review), with ONE
// exception that is not stored but derived: revision 0 of a frame nobody judged in the studio reads as 'approved' or
// 'baseline' when the project's records say so (see standing.mjs). The caller passes `frame.standing` and the file bytes
// it was judged on as `frame.standingPng`; the standing applies only while the stored revision 0 shows those same pixels.
const explicitSql = `(select status from reviews r where r.key=v.key and r.rev=v.rev and status is not null order by seq desc limit 1)`;
const decided = ['approved', 'pending', 'changes_requested'];
const unjudged = (rev, standing) => (rev === 0 && (standing === 'approved' || standing === 'baseline') ? standing : 'pending');

// Real path of the deepest existing ancestor of `p`, with the not-yet-created tail appended.
function realAncestors(p) {
  const tail = [];
  for (let at = p;;) {
    try { return path.join(fs.realpathSync.native(at), ...tail); }
    catch (error) {
      const up = path.dirname(at);
      if (!['ENOENT', 'ENOTDIR'].includes(error.code) || up === at) throw error;
      tail.unshift(path.basename(at));
      at = up;
    }
  }
}

/**
 * Revision and review store. `reservedName` is the project's default in-repo revision directory
 * name (pack directories.revisions); `dir` is a dedicated absolute library directory, never that one.
 */
export function revisionStore(root, reservedName, dir = path.join(root, reservedName)) {
  if (path.isAbsolute(dir)) {
    // Judge every location by its real path, so a symlinked system directory (macOS /var, a
    // symlinked checkout) is no obstacle but an alias of the repository is still the repository.
    // Only the ancestors are resolved: the library directory and its database files must stay
    // real files, so a link planted at or below the library is still refused in open().
    root = fs.realpathSync.native(root);
    dir = path.join(realAncestors(path.dirname(dir)), path.basename(dir));
  }
  const relative = path.relative(root, dir);
  if (!path.isAbsolute(dir) || (!relative.startsWith('..'+path.sep) && !path.isAbsolute(relative)
      && relative !== reservedName) || relative === '..') {
    throw new Error('Use a dedicated absolute library outside the repository or its default revision directory');
  }
  const back = path.relative(dir, root);
  if (back !== '..' && !back.startsWith('..'+path.sep) && !path.isAbsolute(back)) throw new Error('Library cannot contain repository');
  const filename = path.join(dir, 'editor.sqlite');
  let db;
  let readOnly;
  function open(write) {
    if (!fs.lstatSync(dir, {throwIfNoEntry:false})) {
      if (!write) return;
      const parent = path.dirname(dir);
      if (path.relative(fs.realpathSync.native(parent), parent) !== '') throw new Error('Linked library parent');
      try { fs.mkdirSync(dir, {mode:0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (path.relative(fs.realpathSync.native(dir), dir) !== '') throw new Error('Linked revision directory');
    for (const suffix of ['', '-journal', '-shm', '-wal']) {
      const stat = fs.lstatSync(filename+suffix, {throwIfNoEntry:false});
      if (stat && (!stat.isFile() || stat.nlink !== 1)) throw new Error('Invalid revision file');
    }
    if (db && write && readOnly) { db.close(); db = undefined; }
    if (db || (!write && !fs.existsSync(filename))) return;
    const connection = new DatabaseSync(filename, {readOnly: !write});
    try {
      readOnly = !write;
      if (!write) { db = connection; return; }
      fs.chmodSync(filename, 0o600);
      connection.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS versions(key TEXT NOT NULL, rev INTEGER NOT NULL, parent INTEGER,
          png BLOB NOT NULL, meta TEXT NOT NULL, PRIMARY KEY(key,rev));
        CREATE TABLE IF NOT EXISTS origins(key TEXT PRIMARY KEY, stamp TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS reviews(seq INTEGER PRIMARY KEY, key TEXT NOT NULL, rev INTEGER NOT NULL,
          status TEXT, text TEXT, FOREIGN KEY(key,rev) REFERENCES versions(key,rev));
        CREATE INDEX IF NOT EXISTS reviews_by_revision ON reviews(key,rev,seq);
        CREATE TABLE IF NOT EXISTS selections(seq INTEGER PRIMARY KEY, key TEXT NOT NULL, rev INTEGER NOT NULL,
          FOREIGN KEY(key,rev) REFERENCES versions(key,rev));
        CREATE INDEX IF NOT EXISTS selections_by_frame ON selections(key,seq);`);
      db = connection;
    } catch (error) { connection.close(); throw error; }
  }
  let depth = 0; // > 0 inside transaction(): operate then nests as a savepoint instead of committing on its own
  function operate(frame, baseline, action, args) {
    const key = frame.info.key;
    if (action === 'save') {
      const current = operate(frame,baseline,'frame',{});
      if (args.baseRevision !== current.head)
        throw problem(409,'revision_conflict','Reload the current revision',current.head);
      if ((!args.png || args.png.toString('base64') === current.pngBase64) &&
          isDeepStrictEqual({...current.metadata,...args.metadata},current.metadata)) return current;
      // A concurrent writer can still advance the head before BEGIN IMMEDIATE below.
    }
    const write = ['save','restore','review','select'].includes(action);
    open(write);
    if (db) db.exec(depth ? 'SAVEPOINT op' : write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try {
      function append(rev, parent, png, metadata) {
        db.prepare('INSERT INTO versions VALUES(?,?,?,?,?)').run(key, rev, parent, png, JSON.stringify(metadata));
      }
      let head = db?.prepare('SELECT max(rev) AS rev FROM versions WHERE key=?').get(key).rev;
      if (head == null) {
        head = 0;
        if (write) {
          append(0, null, baseline, frame.metadata);
          if (frame.sourceStamp) db.prepare('INSERT INTO origins VALUES(?,?)').run(key,frame.sourceStamp);
        }
      }
      function version(n) {
        const row = db?.prepare('SELECT png,meta FROM versions WHERE key=? AND rev=?').get(key,n);
        if (row) return {png:Buffer.from(row.png), metadata:JSON.parse(row.meta)};
        if (n === 0) return {png:baseline, metadata:frame.metadata};
        throw problem(404,'unknown_revision','Revision does not exist');
      }
      let selected = args.revision ?? head;
      if (action === 'save' || action === 'restore') {
        if (args.baseRevision !== head) throw problem(409,'revision_conflict','Reload the current revision',head);
        const current = version(head);
        const next = action === 'restore' ? version(args.targetRevision) : {
          png:args.png ?? current.png, metadata:{...current.metadata,...args.metadata}
        };
        if (action === 'restore' || !next.png.equals(current.png) ||
            JSON.stringify(next.metadata) !== JSON.stringify(current.metadata)) {
          append(head+1,head,next.png,next.metadata);
          head++;
        }
        selected = head;
      }
      const {png, metadata} = version(selected);
      if (action === 'review') {
        if (args.status !== undefined && !decided.includes(args.status)) throw problem(422,'invalid_input','Invalid review status');
        if (args.status === 'approved' && baseline && frame.sourceStamp) {
          const zero = version(0);
          if (zero.png.equals(baseline) && JSON.stringify(zero.metadata) === JSON.stringify(frame.metadata))
            db.prepare('INSERT OR IGNORE INTO origins VALUES(?,?)').run(key,frame.sourceStamp);
        }
        db.prepare('INSERT INTO reviews(key,rev,status,text) VALUES(?,?,?,?)')
          .run(key,selected,args.status ?? null,args.text ?? null);
      }
      // A take is a revision. Three facts about it stay separate: it is the NEWEST (the head), it is SELECTED (a person picked it:
      // the 'select' action, nothing else writes this) and it is IN USE (its pixels are the file the project uses now, when the caller
      // passed that file's bytes as frame.standingPng). A new take moves only the first; selecting never edits a file.
      if (action === 'select') {
        if (!Number.isInteger(args.revision) || args.revision < 0 || args.revision > head) throw problem(404,'unknown_revision','Revision does not exist');
        db.prepare('INSERT INTO selections(key,rev) VALUES(?,?)').run(key,args.revision);
      }
      const standing = sameImage(version(0).png,frame.standingPng) ? frame.standing : undefined;
      let history = (db?.prepare('SELECT rev AS revision,parent,'+explicitSql+
        ' AS status FROM versions v WHERE key=? ORDER BY rev DESC').all(key) ?? [])
        .map(item => ({...item,status:item.status ?? unjudged(item.revision,standing)}));
      if (!history.length) history = [{revision:0,parent:null,status:unjudged(0,standing)}];
      const comments = (db?.prepare(`SELECT text,(select status from reviews p
        where p.key=r.key and p.rev=r.rev and p.seq<=r.seq and p.status is not null
        order by p.seq desc limit 1) as status FROM reviews r
        WHERE key=? AND rev=? AND text IS NOT NULL ORDER BY seq`).all(key,selected) ?? [])
        .map(c => ({...c,status:c.status ?? unjudged(selected,standing)}));
      const hasSelections = db && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='selections'").get();
      const picked = hasSelections ? db.prepare('SELECT rev FROM selections WHERE key=? ORDER BY seq DESC LIMIT 1').get(key)?.rev ?? null : null;
      const fileHash = frame.standingPng ? createHash('sha256').update(frame.standingPng).digest('hex') : null;
      let inUse = null;
      if (fileHash) for (const item of [...history].reverse()) {
        if (createHash('sha256').update(version(item.revision).png).digest('hex') === fileHash) { inUse = item.revision; break; }
      }
      history = history.map(item => ({...item,newest:item.revision===head,selected:item.revision===picked,inUse:item.revision===inUse}));
      const snapshot = {...frame.info,head,revision:selected,pngBase64:png.toString('base64'),metadata,
        status:history.find(item=>item.revision===selected).status,comments,history,
        takes:{newest:head,selected:picked,inUse}};
      if (db) db.exec(depth ? 'RELEASE op' : 'COMMIT');
      return snapshot;
    } catch (error) {
      if (db) db.exec(depth ? 'ROLLBACK TO op; RELEASE op' : 'ROLLBACK');
      throw error;
    }
  }
  /** Run fn() (synchronous: it calls operate) inside ONE write transaction: if it throws, every write it made is rolled back. */
  function transaction(fn) {
    if (depth) return fn();
    open(true);
    db.exec('BEGIN IMMEDIATE');
    depth++;
    try { const out = fn(); db.exec('COMMIT'); return out; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { depth--; }
  }
  return {operate, transaction, origin(key) {
    open(false);
    if (!db?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='origins'").get()) return null;
    return db.prepare('SELECT stamp FROM origins WHERE key=?').get(key)?.stamp;
  }, needsBaseline(key) {
    open(false);
    return !db?.prepare('SELECT 1 FROM versions WHERE key=? AND rev=0').get(key);
  }, close() { db?.close(); }};
}
