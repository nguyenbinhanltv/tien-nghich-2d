import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check } from '../tools/lib/schemas.ts';
import { parseCsv } from '../tools/lib/repo.ts';
import type { Rgba } from '../tools/lib/repo.ts';
import type { AssetInfo } from '../tools/lib/assets.ts';
import { bodyDigest, compileAudioEvents, compileBodies, compileClipEvents, compileTileShapes, lintClips, verifyApprovals } from '../tools/lib/kiln-contract.ts';
import { alphaBox } from '../tools/draft-bodies.ts';
import { mirrorBox, worldBoxes } from '../src/contracts/bodies.ts';
import type { Body } from '../src/contracts/bodies.ts';

const asset = (id: string, category: string, size: [number, number], clips: Record<string, number>): AssetInfo =>
  ({ id, category, source: 'core', readiness: 'packed', size, directions: ['south', 'east'], clips, chunk: null, name: null });
const assets = new Map([asset('mob_test_wolf', 'mob', [32, 32], { idle: 4, attack: 4 }), asset('ts_test_floor', 'tileset', [16, 16], { sheet: 4 })].map((a) => [a.id, a]));
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'g0b-'));
const goodBody = { frameSize: [32, 32], pivot: [16, 31], hurtbox: { x: 4, y: 8, w: 20, h: 22 }, review: { status: 'draft-unreviewed', source: 'hand' } };

describe('bodies', () => {
  it('accepts a body, and a per-frame hitbox that names its id', () => {
    const b = { ...goodBody, clips: { attack: { frames: { '2': { hitboxes: [{ id: 'bite', x: 20, y: 10, w: 10, h: 8 }] } } } } };
    expect(check('bodies.schema.json#/$defs/body', b, 'b')).toEqual([]);
  });
  it('rejects a hitbox with no id, an unknown field, a zero-size box and an approval with no reference', () => {
    expect(check('bodies.schema.json#/$defs/body', { ...goodBody, clips: { attack: { frames: { '2': { hitboxes: [{ x: 1, y: 1, w: 2, h: 2 }] } } } } }, 'b')).not.toEqual([]);
    expect(check('bodies.schema.json#/$defs/body', { ...goodBody, extra: 1 }, 'b')).not.toEqual([]);
    expect(check('bodies.schema.json#/$defs/body', { ...goodBody, hurtbox: { x: 0, y: 0, w: 0, h: 4 } }, 'b')).not.toEqual([]);
    expect(check('bodies.schema.json#/$defs/body', { ...goodBody, review: { status: 'owner-approved', source: 'hand' } }, 'b')).not.toEqual([]);
  });
  it('compiles source files and flags a box outside the frame, a wrong size, a missing clip', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'mob_test_wolf.bodies.json'), JSON.stringify(goodBody));
    expect(compileBodies(assets, new Map(), dir).problems).toEqual([]);
    fs.writeFileSync(path.join(dir, 'mob_test_wolf.bodies.json'), JSON.stringify({ ...goodBody, frameSize: [64, 64], hurtbox: { x: 30, y: 0, w: 10, h: 4 }, clips: { nope: { frames: {} } } }));
    const p = compileBodies(assets, new Map(), dir).problems.join('\n');
    expect(p).toMatch(/differs from the manifest size/);
    expect(p).toMatch(/has no clip nope/);
    fs.writeFileSync(path.join(dir, 'ghost_thing.bodies.json'), JSON.stringify(goodBody));
    expect(compileBodies(assets, new Map(), dir).problems.join()).toMatch(/unknown asset id ghost_thing/);
  });
  it('reports a body with no review block and broken JSON as problems, and does not store them', () => {
    const dir = tmp();
    const noReview: Record<string, unknown> = { ...goodBody };
    delete noReview.review;
    fs.writeFileSync(path.join(dir, 'mob_test_wolf.bodies.json'), JSON.stringify(noReview));
    const r = compileBodies(assets, new Map(), dir);
    expect(r.problems.join()).toMatch(/review/);
    expect(r.data.bodies).toEqual({});
    expect(() => verifyApprovals(r.data.bodies, path.join(dir, 'x.json'))).not.toThrow();
    fs.writeFileSync(path.join(dir, 'mob_test_wolf.bodies.json'), '{ not json');
    const j = compileBodies(assets, new Map(), dir);
    expect(j.problems.join()).toMatch(/not valid JSON/);
    expect(j.data.bodies).toEqual({});
  });
  it("takes Kiln's metadata hitbox as a draft default hurtbox, never as approval", () => {
    const sc = new Map([['mob_test_wolf', { file: 'x/studio-metadata.json', data: { pivot: [16, 31] as [number, number], hitbox: { x: 4, y: 8, w: 20, h: 22 } } }]]);
    const r = compileBodies(assets, sc, path.join(tmp(), 'none'));
    expect(r.problems).toEqual([]);
    expect((r.data.bodies.mob_test_wolf as { review: { status: string } }).review.status).toBe('draft-unreviewed');
  });
  it('binds an owner approval to a digest of the boxes', () => {
    const dir = tmp(), file = path.join(dir, 'body_approvals.json');
    const approved = { ...goodBody, review: { status: 'owner-approved', source: 'hand', approvalRef: 'a1' } };
    fs.writeFileSync(file, JSON.stringify({ approvals: { a1: { digests: { mob_test_wolf: bodyDigest(approved) } } } }));
    expect(verifyApprovals({ mob_test_wolf: approved }, file)).toMatchObject({ problems: [], approved: 1 });
    const edited = { ...approved, hurtbox: { ...goodBody.hurtbox, w: 21 } };
    expect(verifyApprovals({ mob_test_wolf: edited }, file).problems.join()).toMatch(/changed after the owner approved/);
    expect(verifyApprovals({ mob_test_wolf: approved }, path.join(dir, 'missing.json')).problems.join()).toMatch(/no entry a1/);
    expect(verifyApprovals({ mob_test_wolf: goodBody }, file).unreviewed).toEqual(['mob_test_wolf']);
  });
  it('mirrors a box for west and places boxes on the pivot', () => {
    expect(mirrorBox({ x: 20, y: 5, w: 8, h: 6 }, 32)).toEqual({ x: 4, y: 5, w: 8, h: 6 });
    const body = goodBody as unknown as Body;
    expect(worldBoxes(body, 'idle', 0, 100, 200, false).hurtbox).toEqual({ x: 88, y: 177, w: 20, h: 22 });
    const flipped = worldBoxes(body, 'idle', 0, 100, 200, true).hurtbox;
    expect(flipped.x + flipped.w / 2).toBeGreaterThan(100 - 8); // mirrored body stays centred on the actor
  });
  it('proposes a draft hurtbox from alpha only', () => {
    const w = 8, h = 8, pixels = new Uint8Array(w * h * 4);
    for (let y = 2; y <= 6; y++) for (let x = 1; x <= 5; x++) pixels[(y * w + x) * 4 + 3] = 255;
    pixels[3] = 100; // below the threshold: ignored
    expect(alphaBox({ width: w, height: h, pixels } as Rgba)).toEqual({ x: 2, y: 3, w: 3, h: 3 });
    expect(alphaBox({ width: 2, height: 2, pixels: new Uint8Array(16) } as Rgba)).toBeNull();
  });
});

describe('clip events', () => {
  const side = (events: { frame: number; name: string }[], frameMs?: number[]) => new Map([['mob_test_wolf', { file: 'm.json', data: { clips: { attack: { events, ...(frameMs ? { frameMs } : {}) } } } }]]);
  it('times events from frameMs and falls back (with a warning) to 100 ms', () => {
    const r = compileClipEvents(assets, side([{ frame: 2, name: 'hit' }, { frame: 0, name: 'tell' }], [200, 100, 300, 100]));
    expect(r.problems).toEqual([]);
    expect((r.data.clips.mob_test_wolf!.attack as { events: unknown[] }).events).toEqual([{ frame: 0, name: 'tell', atMs: 0 }, { frame: 2, name: 'hit', atMs: 300 }]);
    const d = compileClipEvents(assets, side([{ frame: 1, name: 'hit' }]));
    expect(d.warnings.join()).toMatch(/default/);
  });
  it('rejects an event name outside the contract and a clip the asset lacks', () => {
    expect(compileClipEvents(assets, side([{ frame: 0, name: 'boom' }])).problems).not.toEqual([]);
    expect(compileClipEvents(assets, new Map([['mob_test_wolf', { file: 'm.json', data: { clips: { dance: { events: [{ frame: 0, name: 'tell' }] } } } }]])).problems.join()).toMatch(/no clip dance/);
  });
  it('lints a tell under 250 ms and a clip with no events', () => {
    const slow = compileClipEvents(assets, side([{ frame: 0, name: 'tell' }, { frame: 1, name: 'hit' }], [300, 100, 100, 100])).data;
    const fast = compileClipEvents(assets, side([{ frame: 0, name: 'tell' }, { frame: 1, name: 'hit' }], [200, 100, 100, 100])).data;
    const target = [{ asset: 'mob_test_wolf', clip: 'attack' }];
    expect(lintClips(slow, target).errors).toEqual([]);
    expect(lintClips(fast, target).errors.join()).toMatch(/floor is 250/);
    expect(lintClips({ clips: {} }, target).warnings.join()).toMatch(/no tell\/hit/);
  });
});

describe('tile shapes', () => {
  const shape = { kind: 'rect', x: 0, y: 0, w: 16, h: 16, properties: { collision: 'block' } };
  const sc = (tiles: unknown, id = 'ts_test_floor') => new Map([[id, { file: 't.json', data: { tiles } as never }]]);
  it('accepts shapes that say how they collide and rejects ones that do not', () => {
    expect(compileTileShapes(assets, sc({ sheet: { 0: { shapes: [shape] } } })).problems).toEqual([]);
    expect(compileTileShapes(assets, sc({ sheet: { 0: { shapes: [{ ...shape, properties: {} }] } } })).problems).not.toEqual([]);
    expect(compileTileShapes(assets, sc({ sheet: { 0: { shapes: [{ ...shape, properties: { collision: 'lava' } }] } } })).problems).not.toEqual([]);
    expect(compileTileShapes(assets, sc({ sheet: { 0: { shapes: [shape] } } }, 'mob_test_wolf')).problems.join()).toMatch(/not a tileset/);
  });
});

describe('audio events (real audio_manifest.json)', () => {
  const a = compileAudioEvents(new Map());
  it('compiles with every cue declared', () => { expect(a.problems).toEqual([]); });
  it('fusion takes the first parent release and the second parent impact', () => {
    const ev = a.data.events;
    expect(ev.lt_reed_verdict).toEqual({ release: ev.lt_reed_blade!.release, impact: ev.lt_seal_chisel!.impact });
    expect(ev.lt_reed_verdict_shot).toEqual(ev.lt_reed_verdict);
  });
  it('keeps silent ids out of the event table', () => { for (const id of a.data.silent) expect(a.data.events[id]).toBeUndefined(); });
});

describe('csv', () => {
  it('reads quotes, doubled quotes, CRLF and empty cells; rejects a ragged row', () => {
    expect(parseCsv('a,b,c\r\n1,"x,y",\r\n2,"he said ""hi""",z\r\n')).toEqual([{ a: '1', b: 'x,y', c: '' }, { a: '2', b: 'he said "hi"', c: 'z' }]);
    expect(() => parseCsv('a,b\n1\n')).toThrow(/row 2/);
  });
});
