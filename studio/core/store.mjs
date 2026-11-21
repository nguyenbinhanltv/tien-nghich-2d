import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { problem } from './errors.mjs';

const stateSql = `coalesce((select status from reviews r where r.key=v.key and r.rev=v.rev
  and status is not null order by seq desc limit 1),case v.rev when 0 then 'approved' else 'pending' end)`;

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
        CREATE INDEX IF NOT EXISTS reviews_by_revision ON reviews(key,rev,seq);`);
      db = connection;
    } catch (error) { connection.close(); throw error; }
  }
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
    const write = ['save','restore','review'].includes(action);
    open(write);
    if (db) db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
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
        if (args.status === 'approved' && baseline && frame.sourceStamp) {
          const zero = version(0);
          if (zero.png.equals(baseline) && JSON.stringify(zero.metadata) === JSON.stringify(frame.metadata))
            db.prepare('INSERT OR IGNORE INTO origins VALUES(?,?)').run(key,frame.sourceStamp);
        }
        db.prepare('INSERT INTO reviews(key,rev,status,text) VALUES(?,?,?,?)')
          .run(key,selected,args.status ?? null,args.text ?? null);
      }
      let history = db?.prepare('SELECT rev AS revision,parent,'+stateSql+
        ' AS status FROM versions v WHERE key=? ORDER BY rev DESC').all(key) ?? [];
      if (!history.length) history = [{revision:0,parent:null,status:'approved'}];
      const comments = db?.prepare(`SELECT text,coalesce((select status from reviews p
        where p.key=r.key and p.rev=r.rev and p.seq<=r.seq and p.status is not null
        order by p.seq desc limit 1),case r.rev when 0 then 'approved' else 'pending' end) as status FROM reviews r
        WHERE key=? AND rev=? AND text IS NOT NULL ORDER BY seq`).all(key,selected) ?? [];
      const snapshot = {...frame.info,head,revision:selected,pngBase64:png.toString('base64'),metadata,
        status:history.find(item=>item.revision===selected).status,comments,history};
      if (db) db.exec('COMMIT');
      return snapshot;
    } catch (error) {
      if (db) db.exec('ROLLBACK');
      throw error;
    }
  }
  return {operate, origin(key) {
    open(false);
    if (!db?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='origins'").get()) return null;
    return db.prepare('SELECT stamp FROM origins WHERE key=?').get(key)?.stamp;
  }, needsBaseline(key) {
    open(false);
    return !db?.prepare('SELECT 1 FROM versions WHERE key=? AND rev=0').get(key);
  }, close() { db?.close(); }};
}
