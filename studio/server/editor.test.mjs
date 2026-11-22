import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createPreviewServer } from '../serve.mjs';
import { encodePixels } from './editor-png.mjs';
import { revisionStore } from './editor-store.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const ui='ui/ui_minimap/room_none_0', vfx='vfx/hit_spark_0';
const servers=new WeakMap();
async function scratch(t) {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'tn-editor-'));
  servers.set(t,[]);
  t.after(async ()=>{
    for (const close of servers.get(t)) await close();
    await fs.rm(temp,{recursive:true,force:true});
  });
  return path.join(temp,'library');
}
async function start(t,dir,host='127.0.0.1') {
  const server=createPreviewServer({revisionDir:dir});
  await new Promise((ok,fail)=>server.once('error',fail).listen(0,host,ok));
  const url='http://127.0.0.1:'+server.address().port;
  async function close() {
    if (server.listening) await new Promise(ok=>server.close(ok));
  }
  servers.get(t).push(close);
  async function call(action,args={},method='GET') {
    const endpoint=url+'/api/editor/'+action;
    const r=method==='GET'?await fetch(endpoint+'?'+new URLSearchParams(args)):
      await fetch(endpoint,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});
    return {status:r.status,data:await r.json()};
  }
  return {url,close,call,post:(action,args)=>call(action,args,'POST')};
}
for (const key of [ui,vfx]) test('save, review, restart, export and restore '+key,async t=>{
  const dir=await scratch(t);
  let api=await start(t,dir);
  const baseline=(await api.call('frame',{key})).data;
  assert.equal(baseline.status,'baseline','shipped legacy art with no review record is baseline, never approved');
  assert.equal(baseline.history[0].status,'baseline');
  assert.equal(baseline.head,0);
  const originalFiles=await Promise.all([baseline.sourceUrl,baseline.processedUrl].map(p=>fs.readFile(path.join(root,p))));
  await assert.rejects(fs.stat(dir),{code:'ENOENT'});
  const noop=(await api.post('save',{key,baseRevision:0,metadata:baseline.metadata})).data;
  assert.equal(noop.head,0);
  assert.equal(noop.status,'baseline');
  assert.deepEqual(noop.comments,[]);
  await assert.rejects(fs.stat(dir),{code:'ENOENT'});
  // The snapshot encoder emits one IDAT and a zero filter byte before each row.
  const canonical=Buffer.from(baseline.pngBase64,'base64');
  const chunkOffset=canonical.indexOf(Buffer.from('IDAT'));
  const scan=inflateSync(canonical.subarray(chunkOffset+4,chunkOffset+4+canonical.readUInt32BE(chunkOffset-4)));
  const stride=baseline.width*4;
  const pixels=Buffer.concat(Array.from({length:baseline.height},(_,y)=>
    scan.subarray(y*(stride+1)+1,(y+1)*(stride+1))));
  const opaque=pixels.findIndex((value,i)=>i%4===3 && value===255);
  assert.ok(opaque>=3);
  pixels.fill(0,opaque-3,opaque+1);
  const pngBase64=encodePixels(baseline.width,baseline.height,pixels).toString('base64');
  assert.notEqual(pngBase64,baseline.pngBase64);
  const metadata=key===ui?{pivot:[0,1]}:{pivot:[1,0],durationMs:120};
  const saved=await api.post('save',{key,baseRevision:0,metadata,pngBase64});
  assert.equal(saved.status,200,JSON.stringify(saved.data.error));
  assert.equal(saved.data.revision,1);
  assert.deepEqual(saved.data.metadata,metadata);
  assert.equal(saved.data.pngBase64,pngBase64);
  assert.equal((await api.post('save',{key,baseRevision:1,pngBase64})).data.head,1);
  assert.equal((await api.post('review',{key,revision:1,status:'changes_requested',text:'Move pivot'})).data.status,'changes_requested');
  const update=await api.post('save',{key,baseRevision:1,metadata:{pivot:[2,2]}});
  assert.equal(update.data.status,'pending');
  await api.post('review',{key,revision:2,status:'approved'});
  await api.post('review',{key,revision:2,text:'Checked at native size'});
  const getExport=()=>api.call('export',{key,revision:2}).then(r=>r.data);
  const exported=await getExport();
  assert.equal(exported.pngBase64,pngBase64);
  assert.deepEqual(exported.metadata,{...metadata,pivot:[2,2]});
  const rect=exported.atlas.frames[key];
  assert.deepEqual(rect.frame,{x:0,y:0,w:baseline.width,h:baseline.height});
  assert.equal(rect.duration,metadata.durationMs);
  assert.equal(rect.pivot.x,2/baseline.width);
  await api.close();
  api=await start(t,dir);
  assert.deepEqual(await getExport(),exported);
  const image=await fetch(api.url+exported.atlas.meta.image);
  assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'),pngBase64);
  const approved=(await api.call('frame',{key})).data;
  assert.equal(approved.status,'approved');
  assert.deepEqual(approved.comments,[{text:'Checked at native size',status:'approved'}]);
  assert.equal((await api.call('frame',{key,revision:1})).data.comments[0].text,'Move pivot');
  const edited=(await api.post('save',{key,baseRevision:2,metadata:{pivot:[0,0]}})).data;
  assert.equal(edited.status,'pending');
  assert.equal(edited.history[1].status,'approved');
  const restored=(await api.post('restore',{key,baseRevision:3,targetRevision:0})).data;
  assert.equal(restored.revision,4);
  assert.equal(restored.status,'pending');
  assert.deepEqual(restored.comments,[]);
  assert.deepEqual(restored.metadata,baseline.metadata);
  assert.equal(restored.pngBase64,baseline.pngBase64);
  assert.deepEqual(restored.history.map(h=>h.parent),[3,2,1,0,null]);
  assert.deepEqual(await getExport(),exported);
  const after=await Promise.all([baseline.sourceUrl,baseline.processedUrl].map(p=>fs.readFile(path.join(root,p))));
  assert.deepEqual(after,originalFiles);
});

test('legacy rows read as baseline (never approved), explicit decisions and comments survive read-only opens',async t=>{
  const dir=await scratch(t);
  const api=await start(t,dir);
  const baseline=(await api.call('frame',{key:ui})).data;
  await fs.mkdir(dir);
  const filename=path.join(dir,'editor.sqlite');
  const db=new DatabaseSync(filename);
  db.exec('CREATE TABLE versions(key TEXT,rev INTEGER,parent INTEGER,png BLOB,meta TEXT);'+
    'CREATE TABLE reviews(seq INTEGER PRIMARY KEY,key TEXT,rev INTEGER,status TEXT,text TEXT)');
  db.prepare('INSERT INTO versions VALUES(?,0,null,?,?)').run(ui,Buffer.from(baseline.pngBase64,'base64'),JSON.stringify(baseline.metadata));
  db.prepare('INSERT INTO reviews VALUES(1,?,0,null,?)').run(ui,'Legacy note');
  db.close();
  const before=await fs.readFile(filename);
  const loaded=(await api.call('frame',{key:ui})).data;
  assert.equal(loaded.status,'baseline');
  assert.deepEqual(loaded.comments,[{text:'Legacy note',status:'baseline'}]);
  assert.deepEqual(await fs.readFile(filename),before);
  await api.post('review',{key:ui,revision:0,status:'changes_requested',text:'Keep note'});
  const noop=(await api.post('save',{key:ui,baseRevision:0,metadata:baseline.metadata})).data;
  assert.equal(noop.status,'changes_requested');
  assert.equal(noop.history.length,1);
  assert.equal(noop.comments.length,2);
  const audit=new DatabaseSync(filename,{readOnly:true});
  assert.equal(audit.prepare('SELECT count(*) AS n FROM reviews').get().n,2);
  audit.close();
});

test('two servers serialize writers and roll back interrupted insertion',async t=>{
  const dir=await scratch(t), a=await start(t,dir), b=await start(t,dir);
  const save=(api,x)=>api.post('save',{key:ui,baseRevision:0,metadata:{pivot:[x,0]}});
  const pair=await Promise.all([save(a,1),save(b,2)]);
  assert.deepEqual(pair.map(r=>r.status).sort(),[200,409]);
  const conflict=pair.find(r=>r.status===409).data;
  assert.equal(conflict.head,1);
  assert.equal(conflict.error.code,'revision_conflict');
  const db=new DatabaseSync(path.join(dir,'editor.sqlite'));
  try {
    db.exec("CREATE TRIGGER interrupt AFTER INSERT ON versions BEGIN SELECT RAISE(ABORT,'test interruption'); END;");
    assert.equal((await a.post('restore',{key:ui,baseRevision:1,targetRevision:0})).status,500);
    assert.equal((await b.call('frame',{key:ui})).data.head,1);
    db.exec('DROP TRIGGER interrupt');
  } finally {db.close();}
  assert.equal((await b.post('restore',{key:ui,baseRevision:1,targetRevision:0})).data.head,2);
});

test('reject invalid input before writing and keep legacy static paths',async t=>{
  const dir=await scratch(t), api=await start(t,dir);
  const list=(await api.call('frames')).data.frames;
  assert.equal(list.filter(f=>f.category==='ui').length,30);
  assert.equal(list.filter(f=>f.key.startsWith('vfx/')).length,391);
  const {width,height}=list.find(f=>f.key===ui);
  const raw=Buffer.alloc(width*height*4);
  for (const rgba of [[0,0,0,1],[1,2,3,255]]) {
    raw.set(rgba);
    assert.equal((await api.post('save',{key:ui,baseRevision:0,pngBase64:encodePixels(width,height,raw).toString('base64')})).status,422);
  }
  for (const patch of [{pngBase64:'?'},{pngBase64:'YWJj'},{pngBase64:encodePixels(1,1,raw).toString('base64')},
      {metadata:{pivot:[width,0]}},{metadata:{durationMs:100}},{metadata:{file:'unknown'}},{baseRevision:null}]) {
    assert.equal((await api.post('save',{key:ui,baseRevision:0,...patch})).status,422);
  }
  assert.equal((await api.post('save',{key:vfx,baseRevision:0,metadata:{durationMs:0}})).status,422);
  assert.equal((await api.post('review',{key:ui,revision:0,status:'unrecognized'})).status,422);
  assert.equal((await api.call('frame',{key:'../manifest.json'})).status,404);
  assert.equal((await api.call('frame',{key:ui,revision:42})).status,404);
  assert.equal((await api.call('export',{key:ui})).status,422);
  for (const headers of [{Origin:'https://example.org'},{Host:'example.org'},{'Sec-Fetch-Site':'cross-site'}]) {
    const status=await new Promise((resolve,reject)=>http.get(api.url+'/api/editor/frames',{headers},res=>{
      res.resume();
      resolve(res.statusCode);
    }).on('error',reject));
    assert.equal(status,403);
  }
  const endpoint=api.url+'/api/editor/save';
  assert.equal((await fetch(endpoint,{method:'POST',body:'{}'})).status,415);
  for (const [payload,status] of [['{',400],[' '.repeat(200000),413]]) {
    assert.equal((await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:payload})).status,status);
  }
  assert.equal((await fetch(endpoint)).status,405);
  const publicServer=await start(t,dir,'0.0.0.0');
  assert.equal((await publicServer.call('frames')).status,403);
  await assert.rejects(fs.stat(dir),{code:'ENOENT'});
  assert.throws(()=>revisionStore(root,path.join(root,'assets')));
  assert.doesNotThrow(()=>revisionStore(root));
  assert.equal((await fetch(api.url+'/.inspector-revisions/editor.sqlite')).status,403);
  assert.equal((await fetch(api.url+'/assets/manifest.json')).status,200);
});

test('linked library and linked database leave the target untouched',async t=>{
  const dir=await scratch(t);
  const protectedDir=path.join(path.dirname(dir),'source');
  await fs.mkdir(protectedDir);
  await fs.symlink(protectedDir,dir,process.platform==='win32'?'junction':'dir');
  const api=await start(t,dir);
  const save=()=>api.post('save',{key:ui,baseRevision:0,metadata:{pivot:[0,0]}});
  assert.equal((await save()).status,500);
  assert.deepEqual(await fs.readdir(protectedDir),[]);
  await fs.unlink(dir);
  await fs.mkdir(dir);
  const original=path.join(protectedDir,'fixture.txt');
  await fs.writeFile(original,'original');
  await fs.link(original,path.join(dir,'editor.sqlite'));
  assert.equal((await save()).status,500);
  assert.equal(await fs.readFile(original,'utf8'),'original');
});
