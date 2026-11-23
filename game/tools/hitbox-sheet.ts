// Static review page for the draft boxes: every frame of every body drawn at x4 with the boxes on top, one section per id.
// For the owner to look at; it approves nothing and writes nothing into the repository unless --out points there.
//   node tools/hitbox-sheet.ts --out <file.html> [--assets id,id] [--bodies dir]     default bodies dir: game/content/hitbox
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GAME, readJson } from './lib/repo.ts';
import { loadAssets } from './lib/assets.ts';
import { draftFor, findDir, vsIds } from './draft-bodies.ts';
import type { DraftBody } from './draft-bodies.ts';

const Z = 4;
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function frameCell(file: string, label: string, body: DraftBody | null, clip: string, n: number, w: number, h: number): string {
  const uri = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  let svg = '';
  if (body) {
    const f = body.clips?.[clip]?.frames[String(n)];
    const hb = f?.hurtbox ?? body.hurtbox;
    svg += `<rect x="${hb.x * Z}" y="${hb.y * Z}" width="${hb.w * Z}" height="${hb.h * Z}" class="hurt"/>`;
    for (const x of f?.hitboxes ?? []) svg += `<rect x="${x.x * Z}" y="${x.y * Z}" width="${x.w * Z}" height="${x.h * Z}" class="hit"><title>${esc(x.id)}</title></rect>`;
    const [px, py] = body.pivot;
    svg += `<path d="M${px * Z + Z / 2 - 6} ${py * Z + Z / 2}h12M${px * Z + Z / 2} ${py * Z + Z / 2 - 6}v12" class="pivot"/>`;
  }
  return `<figure><div class="f" style="width:${w * Z}px;height:${h * Z}px"><img src="${uri}" width="${w * Z}" height="${h * Z}"><svg width="${w * Z}" height="${h * Z}">${svg}</svg></div><figcaption>${esc(label)}</figcaption></figure>`;
}

export async function buildSheet(ids: string[], bodiesDir: string): Promise<string> {
  const assets = loadAssets('mobile');
  const decodeSize = (file: string): [number, number] => { const b = fs.readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  let sections = '', withBody = 0, without = 0;
  for (const id of ids) {
    const info = assets.get(id);
    const file = path.join(bodiesDir, `${id}.bodies.json`);
    const body = fs.existsSync(file) ? readJson<DraftBody>(file) : null;
    const dir = findDir(id);
    let inner = '', badge: string, facts: string;
    if (body) {
      withBody++;
      badge = '<span class="badge draft">NHÁP, chờ duyệt</span>';
      const hits = Object.entries(body.clips ?? {}).flatMap(([c, v]) => Object.entries(v.frames).flatMap(([n, f]) => f.hitboxes.map((h) => `${c}[${n}] ${h.id} ${h.x},${h.y} ${h.w}×${h.h}`)));
      facts = `<p>hurtbox ${body.hurtbox.x},${body.hurtbox.y} ${body.hurtbox.w}×${body.hurtbox.h} · pivot ${body.pivot.join(',')} · khung ${body.frameSize.join('×')}</p><p class="note">${esc(body.review.note)}</p>${hits.length ? `<p>hitbox nháp: ${hits.map(esc).join(' · ')}</p>` : '<p>hitbox tấn công: không đề xuất</p>'}`;
      const clips = info?.clips ?? {};
      const [fw, fh] = body.frameSize;
      for (const [clip, count] of Object.entries(clips)) {
        const dirName = info!.directions.includes('east') ? 'east' : 'none';
        const cells: string[] = [];
        for (let n = 0; n < count; n++) {
          const f = path.join(dir!, `${clip}_${dirName}_${n}.png`);
          if (fs.existsSync(f)) cells.push(frameCell(f, `${clip} ${n}`, body, clip, n, fw, fh));
        }
        if (cells.length) inner += `<div class="clip"><h4>${esc(clip)}${dirName === 'east' ? ' · hướng E (W lật, S/N dùng cùng hộp)' : ''}</h4><div class="row">${cells.join('')}</div></div>`;
      }
    } else {
      without++;
      const r = await draftFor(id, info);
      badge = '<span class="badge none">không có thân va chạm</span>';
      facts = `<p>${esc('skip' in r ? r.skip : '')}</p>`;
      // one sample frame so the owner can see which asset this is
      const sample = dir && fs.readdirSync(dir).filter((n) => n.endsWith('.png')).sort()[0];
      const vfx = path.join(GAME, '../assets/processed/vfx', `${id}_0.png`);
      const f = sample && dir ? path.join(dir, sample) : fs.existsSync(vfx) ? vfx : null;
      if (f) { const [w, h] = decodeSize(f); inner = `<div class="row">${frameCell(f, path.basename(f), null, '', 0, w, h)}</div>`; }
    }
    sections += `<section id="${id}"><h3>${esc(id)} ${info?.name ? `<small>${esc(info.name.vi)}</small>` : ''} <small>${esc(info?.category ?? 'vfx')}</small> ${badge}</h3>${facts}${inner}</section>`;
  }
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Hitbox nháp, 51 ID Vertical Slice</title><style>
body{background:#1c1826;color:#e9e3f3;font:14px/1.4 system-ui,sans-serif;margin:0 auto;max-width:1500px;padding:16px}
h1{font-size:20px} h3{margin:0 0 4px} h4{margin:8px 0 4px;color:#b9aed0;font-weight:500} small{color:#9a8fb3;font-weight:400;font-size:12px;margin-left:6px}
section{border-top:1px solid #3a3150;padding:14px 0} p{margin:2px 0} .note{color:#9a8fb3;font-size:12px}
.row{display:flex;flex-wrap:wrap;gap:8px} figure{margin:0} figcaption{font-size:11px;color:#9a8fb3}
.f{position:relative;background:repeating-conic-gradient(#2a2438 0 25%,#231e30 0 50%) 0 0/16px 16px} .f img{image-rendering:pixelated;position:absolute;left:0;top:0} .f svg{position:absolute;left:0;top:0}
.hurt{fill:rgba(80,220,120,.14);stroke:#50dc78;stroke-width:1.5} .hit{fill:rgba(255,70,70,.3);stroke:#ff4646;stroke-width:1.5} .pivot{stroke:#ffd23f;stroke-width:2;fill:none}
.badge{font-size:11px;padding:2px 8px;border-radius:9px;margin-left:8px} .draft{background:#5b3d12;color:#ffd58a} .none{background:#33304a;color:#b9aed0}
.legend span{margin-right:16px} nav a{color:#9ec3ff;margin-right:8px;font-size:12px}
</style><body><h1>Hitbox nháp cho 51 ID Vertical Slice: ${withBody} có thân, ${without} không</h1>
<p><b>Đây là bản nháp tự động, chưa ai duyệt.</b> Trang này không ghi bản duyệt nào. Hộp suy ra từ alpha khung (ngưỡng 128), hộp tấn công đoán từ phần thò ra ngoài thân ở các khung tấn công hướng E (chưa có clip event).</p>
<p class="legend"><span style="color:#50dc78">▇ hurtbox (nhận sát thương)</span><span style="color:#ff4646">▇ hitbox (gây sát thương, theo khung)</span><span style="color:#ffd23f">✚ pivot (chân)</span> Phóng ×${Z}, hộp theo pixel khung.</p>
<nav>${ids.map((i) => `<a href="#${i}">${i}</a>`).join('')}</nav>${sections}</body></html>`;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const flag = (n: string): string | undefined => { const i = argv.indexOf(n); return i < 0 ? undefined : argv[i + 1]; };
  const out = flag('--out');
  if (!out) throw new Error('--out <file.html> is required');
  const html = await buildSheet(flag('--assets')?.split(',') ?? vsIds(), path.resolve(flag('--bodies') ?? path.join(GAME, 'content/hitbox')));
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`wrote ${out} (${(html.length / 1048576).toFixed(1)} MiB)`);
}
