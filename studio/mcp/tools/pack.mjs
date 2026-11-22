import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { packPages, pageBytes, writePages } from '../../core/atlas.mjs';
import { listFrames } from '../../core/assets.mjs';
import { readInside } from '../../core/files.mjs';
import { decodeRgba } from '../../core/png.mjs';
import { ToolError } from '../registry.mjs';
import { shown } from '../workflow/forge.mjs';
import { backgroundProp, inlineOrJob, jsonResult, loadAsset } from './_shared.mjs';

/** Real path of `p` even when it does not exist yet: the deepest existing ancestor is resolved (macOS /var is a link), the rest appended. */
async function realOf(p) {
  const tail = [];
  for (let at = path.resolve(p); ; ) {
    try { return path.join(await fs.realpath(at), ...tail); }
    catch (error) {
      const up = path.dirname(at);
      if (error.code !== 'ENOENT' || up === at) throw error;
      tail.unshift(path.basename(at));
      at = up;
    }
  }
}

/** SHA-256 of every file under the directories, in a stable order: used to prove the shipped atlases did not change. */
async function fingerprint(root, dirs) {
  const hash = crypto.createHash('sha256');
  async function walk(abs, rel) {
    let entries;
    try { entries = await fs.readdir(abs, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.isDirectory()) await walk(path.join(abs, e.name), `${rel}/${e.name}`);
      else if (e.isFile()) hash.update(`${rel}/${e.name}:${crypto.createHash('sha256').update(await fs.readFile(path.join(abs, e.name))).digest('hex')}\n`);
    }
  }
  for (const d of dirs) await walk(path.join(root, d), d);
  return hash.digest('hex');
}

export default {
  name: 'studio_pack',
  title: 'Pack a chunk into STAGING atlases and check its budget',
  description:
    'Pack every frame of a Longtime chunk (the processed frames of assets that have them, otherwise the raw frames you submitted) into texture atlases for web and mobile, in a STAGING area, ' +
    'and check the chunk against its budget: the mobile page ceiling and memory ceiling from the design manifest (pages 1024x1024, padding 2, extrude 1, 4 bytes per pixel) and the web page size. ' +
    'It answers "does this asset still fit its chunk, and how many pages" before anything is delivered. ' +
    'It NEVER writes to the shipped atlases or the processed directories, and proves it: the shipped atlas directories are fingerprinted before and after and must be identical. ' +
    'Output: pages and a description per page under the staging path returned, page counts, bytes, and per-asset frame counts. Packing is deterministic. Delivering atlases is a human step.',
  scope: 'author',
  inputSchema: {
    type: 'object',
    properties: {
      chunk: { type: 'string', maxLength: 40, description: 'Chunk group to pack, e.g. abode or mist_archive (see studio_catalog_search chunk).' },
      platform: { type: 'string', enum: ['web', 'mobile', 'both'], description: 'Which atlas profile to pack and check (default both).' },
      background: backgroundProp,
    },
    required: ['chunk'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  async handler(args, ctx) {
    const ws = ctx.project.workspace;
    const snap = await ws.snapshot();
    const { pack, index } = snap;
    const chunks = index.info.chunks ?? {};
    if (!Object.hasOwn(chunks, args.chunk)) throw new ToolError(`No chunk "${args.chunk}". Chunks: ${Object.keys(chunks).join(', ') || 'none'}.`);
    const platforms = args.platform && args.platform !== 'both' ? [args.platform] : ['web', 'mobile'];
    const shipped = [...new Set(Object.values(pack.directories.atlases))];
    const staging = path.join(ws.libraryDir(), 'staging', args.chunk);
    const real = await realOf(staging), root = await fs.realpath(ws.root);
    for (const dir of shipped) {
      const guarded = await realOf(path.join(root, dir));
      if (real === guarded || real.startsWith(guarded + path.sep)) throw new ToolError(`The staging area ${path.relative(root, real)} lies inside a shipped atlas directory (${dir}); refusing.`);
    }

    return inlineOrJob(ctx, 'pack', args, async (log) => {
      const before = await fingerprint(ws.root, shipped);
      const members = [...index.assets.values()].filter((a) => a.chunk === args.chunk && a.layout);
      const sprites = [], perAsset = {};
      for (const asset of members) {
        let found = await listFrames(ws.root, asset, 'processed'), stage = 'processed';
        if (!found.frames.length) { found = await listFrames(ws.root, asset, 'raw'); stage = 'raw'; }
        if (!found.frames.length) continue;
        perAsset[asset.id] = { stage, frames: found.frames.length };
        for (const f of found.frames) {
          const image = decodeRgba(await readInside(ws.root, f.rel));
          sprites.push({ key: f.key, image, extra: { ...(asset.pivot ? { pivotPx: asset.pivot } : {}), ...(asset.clips?.[f.clip]?.frameMs ? { durationMs: asset.clips[f.clip].frameMs } : {}) } });
        }
      }
      if (!sprites.length) throw new ToolError(`Chunk ${args.chunk} has no frames yet (no processed frames and no submitted raw frames).`);
      log(`packing ${sprites.length} frame(s) of ${Object.keys(perAsset).length} asset(s) for ${platforms.join(' and ')}`);

      await fs.rm(staging, { recursive: true, force: true });
      const result = {};
      for (const platform of platforms) {
        const profile = pack.atlasProfiles[platform];
        if (!profile) throw new ToolError(`The pack defines no "${platform}" atlas profile.`);
        let packed;
        try { packed = packPages(sprites, profile); } catch (error) { if (error.code === 'sprite_too_large') throw new ToolError(error.message); throw error; }
        const pages = writePages(packed, profile);
        const dir = path.join(staging, platform);
        await fs.mkdir(dir, { recursive: true });
        for (const p of pages) {
          await fs.writeFile(path.join(dir, `${p.name}.png`), p.png);
          await fs.writeFile(path.join(dir, `${p.name}.json`), JSON.stringify(p.json, null, 2) + '\n');
        }
        const bpp = platform === 'mobile' ? (index.info.mobile?.bytes_per_pixel ?? 4) : 4;
        const bytes = pageBytes(packed.pages, bpp);
        const entry = { pages: pages.length, pageSizes: pages.map((p) => [p.width, p.height]), bytes, frames: sprites.length, files: pages.map((p) => ({ name: `${p.name}.png`, sha256: p.sha256 })), profile: packed.profile };
        if (platform === 'mobile') {
          const ceiling = chunks[args.chunk], page = index.info.mobile?.page ?? [profile.limit, profile.limit];
          const maxBytes = ceiling * page[0] * page[1] * bpp;
          const problems = [];
          if (pages.length > ceiling) problems.push(`${pages.length} page(s) exceed the chunk's ceiling of ${ceiling}`);
          if (bytes > maxBytes) problems.push(`${bytes} bytes exceed the memory ceiling of ${maxBytes}`);
          entry.budget = { pages: { used: pages.length, ceiling }, bytes: { used: bytes, ceiling: maxBytes }, pass: problems.length === 0, ...(problems.length ? { problems } : {}) };
        } else entry.budget = { pages: { used: pages.length }, pass: true, note: 'web pages are limited by size only' };
        result[platform] = entry;
      }

      const after = await fingerprint(ws.root, shipped);
      if (after !== before) throw new Error('the shipped atlas directories changed during packing; this must never happen');
      const pass = Object.values(result).every((r) => r.budget.pass);
      const out = { ok: true, pass, chunk: args.chunk, staging: shown(ws, staging), assets: perAsset, ...result, shippedAtlases: { unchanged: true, fingerprint: after.slice(0, 16), directories: shipped },
        note: 'Staging only. Nothing was written to the shipped atlases; delivering atlases is a human step.' };
      return jsonResult(out);
    });
  },
};
