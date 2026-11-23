import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alphaBox, bodyClass, clampBox, draftClipHits, reach } from '../tools/lib/hitbox-draft.ts';
import { compileBodies, verifyApprovals } from '../tools/lib/kiln-contract.ts';
import { loadAssets } from '../tools/lib/assets.ts';
import { draftFor, vsIds } from '../tools/draft-bodies.ts';
import { GAME } from '../tools/lib/repo.ts';
import type { Rgba } from '../tools/lib/repo.ts';

const img = (w: number, h: number, rects: [number, number, number, number][]): Rgba => {
  const pixels = new Uint8Array(w * h * 4);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pixels[(y * w + x) * 4 + 3] = 255;
  return { width: w, height: h, pixels };
};

describe('hitbox draft helpers', () => {
  it('alphaBox insets the solid bbox; tiny or empty frames give null', () => {
    expect(alphaBox(img(16, 16, [[4, 4, 10, 12]]))).toEqual({ x: 5, y: 5, w: 4, h: 6 });
    expect(alphaBox(img(16, 16, [[4, 4, 6, 6]]))).toBeNull();
    expect(alphaBox(img(16, 16, []))).toBeNull();
  });
  it('reach is the part outside the body box', () => {
    const r = reach(img(16, 16, [[4, 4, 8, 12], [8, 6, 13, 8]]), { x: 4, y: 4, w: 4, h: 8 });
    expect(r).toEqual({ box: { x: 8, y: 6, w: 5, h: 2 }, pixels: 10 });
  });
  it('draftClipHits keeps the strike frames by reach, otherwise falls back to the lunge frame', () => {
    const body = { x: 4, y: 4, w: 4, h: 8 };
    const idle = [[4, 4, 8, 12]] as [number, number, number, number][];
    const hits = draftClipHits([img(16, 16, idle), img(16, 16, [...idle, [8, 6, 10, 8]]), img(16, 16, [...idle, [8, 6, 14, 9]]), img(16, 16, idle)], body, 'attack');
    expect(hits.map((h) => [h.frame, h.how])).toEqual([[2, 'reach']]);
    expect(hits[0]!.id).toBe('attack');
    const lunge = draftClipHits([img(16, 16, idle), img(16, 16, [[4, 4, 8, 8]]), img(16, 16, [[4, 4, 8, 9]])], body, 'attack_claw');
    expect(lunge.map((h) => [h.frame, h.how, h.id])).toEqual([[1, 'lunge', 'claw']]);
  });
  it('clampBox keeps a box inside the frame', () => { expect(clampBox({ x: -2, y: 30, w: 50, h: 9 }, 32, 32)).toEqual({ x: 0, y: 30, w: 32, h: 2 }); });
  it('classes follow the art category', () => {
    expect(['mob', 'boss', 'player', 'projectile', 'prop', 'tileset', 'weapon', 'ui', 'icon'].map(bodyClass)).toEqual(['actor', 'actor', 'player', 'projectile', 'prop', 'none', 'none', 'none', 'none']);
  });
});

describe('VS draft bodies (real assets)', () => {
  const assets = loadAssets('mobile');
  it('the owner-approved VS list has 51 ids', () => { expect(vsIds()).toHaveLength(51); });
  it('every id gets a draft or a stated reason, and drafts are never owner-approved', async () => {
    for (const id of vsIds()) {
      const d = await draftFor(id, assets.get(id));
      if ('skip' in d) { expect(d.skip.length).toBeGreaterThan(5); continue; }
      expect(d.body.review).toMatchObject({ status: 'draft-unreviewed', source: 'alpha-auto' });
      expect(d.body.hurtbox.w).toBeGreaterThan(0);
    }
  }, 60_000);
  it('the tracked drafts under content/hitbox compile, verify as unreviewed and equal a fresh draft run', async () => {
    const c = compileBodies(assets, new Map());
    expect(c.problems).toEqual([]);
    const v = verifyApprovals(c.data.bodies);
    expect(v.problems).toEqual([]);
    expect(v.approved).toBe(0);
    const dir = path.join(GAME, 'content/hitbox');
    const files = fs.readdirSync(dir).filter((n) => n.endsWith('.bodies.json'));
    expect(files.length).toBeGreaterThanOrEqual(24);
    for (const f of files) {
      const id = f.replace('.bodies.json', '');
      const fresh = await draftFor(id, assets.get(id));
      const tracked = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { review: { source: string } };
      // a hand-edited body is allowed to differ; an untouched alpha-auto one must match the tool's output
      if (tracked.review.source === 'alpha-auto') expect('body' in fresh ? fresh.body : null).toEqual(tracked);
    }
  }, 60_000);
});

describe('body folders precedence', () => {
  it('the earlier folder wins for an id in both; the later copy only warns', async () => {
    const assets = loadAssets('mobile');
    const d = await draftFor('mob_blood_wolf', assets.get('mob_blood_wolf'));
    if ('skip' in d) throw new Error('no draft');
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-a-')), b = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-b-'));
    const first = { ...d.body, hurtbox: { ...d.body.hurtbox, w: d.body.hurtbox.w - 1 } };
    fs.writeFileSync(path.join(a, 'mob_blood_wolf.bodies.json'), JSON.stringify(first));
    fs.writeFileSync(path.join(b, 'mob_blood_wolf.bodies.json'), JSON.stringify(d.body));
    const c = compileBodies(assets, new Map(), [a, b]);
    expect(c.problems).toEqual([]);
    expect(c.warnings.join('\n')).toMatch(/ignored, mob_blood_wolf already has a body from an earlier folder/);
    expect((c.data.bodies.mob_blood_wolf as { hurtbox: { w: number } }).hurtbox.w).toBe(first.hurtbox.w);
  });
});
