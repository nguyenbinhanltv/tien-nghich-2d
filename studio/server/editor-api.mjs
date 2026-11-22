import { loadCatalog, loadStanding, problem } from './editor-catalog.mjs';
import { normalizePng } from './editor-png.mjs';
import { revisionStore } from './editor-store.mjs';
import { assertLoopback } from './loopback.mjs';

function invalid(message) { throw problem(422,'invalid_input',message); }
function fields(obj, allowed) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).some(k=>!allowed.includes(k))) {
    invalid('Unexpected fields or invalid object');
  }
}
function integer(n) {
  if (!Number.isSafeInteger(n) || n < 0) invalid('Expected nonnegative integer revision');
}
async function body(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw problem(415,'unsupported_media_type','Send application/json');
  }
  let size=0;
  const chunks=[];
  const limit=192*1024;
  if (Number(req.headers['content-length']) > limit) throw problem(413,'too_large','Request too large');
  for await (const chunk of req.iterator({destroyOnReturn:false})) {
    size+=chunk.length;
    if (size>limit) throw problem(413,'too_large','Request too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))); }
  catch { throw problem(400,'invalid_json','Invalid JSON'); }
}
const actions = {
  frames:['assetId','category'], frame:['key','revision'],image:['key','revision'],export:['key','revision'],
  save:['key','baseRevision','pngBase64','metadata'],restore:['key','baseRevision','targetRevision'],
  review:['key','revision','status','text']
};
function validate(action,args,frame,palette) {
  if (['save','restore'].includes(action)) integer(args.baseRevision);
  if (action === 'restore') integer(args.targetRevision);
  if (action === 'review') {
    integer(args.revision);
    if ('text' in args && (typeof args.text !== 'string' || !args.text.trim() || args.text.length>2000)) invalid('Invalid review text');
    if ('status' in args && !['pending','approved','changes_requested'].includes(args.status)) invalid('Invalid review status');
    if (!('text' in args || 'status' in args)) invalid('Empty review');
  }
  if (action !== 'save') return;
  if (!('metadata' in args || 'pngBase64' in args)) invalid('Empty save');
  const {width,height,editableFields}=frame.info;
  if ('metadata' in args) {
    fields(args.metadata,editableFields);
    if (!Object.keys(args.metadata).length) invalid('Empty metadata');
    if ('pivot' in args.metadata) {
      const p=args.metadata.pivot;
      if (!Array.isArray(p) || p.length!==2 || !p.every(Number.isInteger) ||
          p[0]<0 || p[0]>=width || p[1]<0 || p[1]>=height) invalid('Pivot must be inside the frame');
    }
    if ('durationMs' in args.metadata) {
      const d=args.metadata.durationMs;
      if (!Number.isInteger(d) || d<1 || d>60000) invalid('Invalid frame duration');
    }
  }
  if ('pngBase64' in args) {
    const s=args.pngBase64;
    if (typeof s!=='string' || !s.length) invalid('Invalid PNG encoding');
    const bytes=Buffer.from(s,'base64');
    if (bytes.toString('base64')!==s) invalid('Expected canonical base64');
    args.png=normalizePng(bytes,width,height,palette);
  }
}
function exportFrame({key,revision,pngBase64,metadata,width:w,height:h}) {
  const rect={x:0,y:0,w,h};
  const entry={frame:rect,rotated:false,trimmed:false,spriteSourceSize:rect,sourceSize:{w,h},
    pivot:{x:metadata.pivot[0]/w,y:metadata.pivot[1]/h}};
  if (metadata.durationMs!==undefined) entry.duration=metadata.durationMs;
  const image='/api/editor/image?'+new URLSearchParams({key,revision});
  return {key,revision,pngBase64,metadata,atlas:{frames:{[key]:entry},meta:{image,format:'RGBA8888',size:{w,h},scale:'1'}}};
}
export function editorApi(root,dir,packDir) {
  const store=revisionStore(root,dir,packDir);
  let catalog, standing;
  return {close:store.close,async handle(req,res,url,address) {
    if (!url.pathname.startsWith('/api/editor/')) return false;
    function send(status,data,type='application/json') {
      res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      res.end(type==='image/png'?data:JSON.stringify(data));
    }
    try {
      assertLoopback(req,address);
      const action=url.pathname.slice('/api/editor/'.length);
      if (!Object.hasOwn(actions,action)) throw problem(404,'unknown_route','Unknown editor route');
      const write=['save','restore','review'].includes(action);
      if (req.method!==(write?'POST':'GET')) throw problem(405,'method_not_allowed','Unsupported method');
      if (write && url.search) invalid('Unexpected query');
      const params=[...url.searchParams.keys()];
      if (params.length!==new Set(params).size) invalid('Repeated query field');
      const args=write?await body(req):Object.fromEntries(url.searchParams);
      fields(args,actions[action]);
      catalog ??= loadCatalog(root,packDir).catch(error=>{catalog=undefined;throw error;});
      const library=await catalog;
      if (action==='frames') send(200,{frames:[...library.frames.values()].map(f=>f.info)
        .filter(f=>(args.assetId===undefined||f.assetId===args.assetId)&&(args.category===undefined||f.category===args.category))});
      else {
        const frame=library.frames.get(args.key);
        if (!frame) throw problem(404,'unknown_frame','Frame is outside the editable catalog');
        if (!write && args.revision!==undefined) {
          if (!/^(0|[1-9][0-9]*)$/.test(args.revision)) invalid('Invalid revision');
          args.revision=Number(args.revision);
          integer(args.revision);
        }
        if (['image','export'].includes(action) && args.revision===undefined) invalid('Specify an exact revision');
        validate(action,args,frame,library.palette);
        const needsOrigin = action === 'review' && args.status === 'approved';
        const baseline=store.needsBaseline(args.key) || needsOrigin ? await library.baseline(frame) : null;
        // How revision 0 reads when nobody judged it here: approved by a hash-tied record, baseline, or awaiting review.
        standing ??= loadStanding(root,packDir).catch(error=>{standing=undefined;throw error;});
        const {standing:state,png:standingPng}=await (await standing).judged(frame.processed);
        const snap=store.operate({...frame,standing:state,standingPng},baseline,action,args);
        if (action==='image') send(200,Buffer.from(snap.pngBase64,'base64'),'image/png');
        else send(200,action==='export'?exportFrame(snap):snap);
      }
    } catch (e) {
      const known=Number.isInteger(e.status);
      send(known?e.status:500,{error:{code:known?e.code:'storage_error',message:known?e.message:'Editor library unavailable'},head:e.head});
    }
    return true;
  }};
}
