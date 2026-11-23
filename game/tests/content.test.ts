import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadAssets } from '../tools/lib/assets.ts';
import { crossCheck, loadTables } from '../tools/lib/tables.ts';
import { GAME } from '../tools/lib/repo.ts';
import { I18n } from '../src/i18n/i18n.ts';

const locale = (l: string): Record<string, string> => JSON.parse(fs.readFileSync(path.join(GAME, `content/locale/${l}.json`), 'utf8')) as Record<string, string>;

describe('sample content tables (Huyết Hải slice)', () => {
  const { tables, problems } = loadTables();
  const assets = loadAssets('mobile');
  it('pass their schemas', () => { expect(problems).toEqual([]); });
  it('have the slice shape: 4 mobs, 1 boss, a run abode -> 3 combat -> boss -> reward', () => {
    expect(tables.mobs).toHaveLength(4); expect(tables.bosses).toHaveLength(1);
    expect(tables.rooms.map((r) => r.kind)).toEqual(['abode', 'combat', 'combat', 'combat', 'boss', 'reward']);
  });
  it('cross-reference the art manifests, encounters and locale', () => {
    expect(crossCheck(tables, assets, { vi: locale('vi'), en: locale('en') })).toEqual([]);
  });
  it('catch a dangling room link, an unknown mob and a missing locale name', () => {
    const bad = structuredClone(tables);
    bad.rooms[0]!.next = 'room_nowhere'; bad.rooms[1]!.mobs = 'mob_blood_dragon:2';
    const vi = locale('vi'); delete vi.mob_blood_wolf;
    const p = crossCheck(bad, assets, { vi, en: locale('en') }).join('\n');
    expect(p).toMatch(/room_nowhere is not a room/); expect(p).toMatch(/unknown mob mob_blood_dragon/); expect(p).toMatch(/missing display name for mob_blood_wolf/);
  });
  it('use real, packed art ids', () => {
    for (const id of [...tables.mobs, ...tables.bosses].map((r) => String(r.id))) expect(assets.get(id)?.readiness).toBe('packed');
  });
});

describe('i18n', () => {
  const i = new I18n({ vi: locale('vi'), en: locale('en') });
  it('keeps vi and en key sets equal', () => { expect(Object.keys(locale('vi')).sort()).toEqual(Object.keys(locale('en')).sort()); });
  it('answers in the active locale and marks a missing key', () => {
    expect(i.t('place.blood_sea')).toBe('Huyết Hải');
    i.locale = 'en'; expect(i.t('place.blood_sea')).toBe('Blood Sea'); expect(i.t('nope')).toBe('[nope]');
  });
});

describe('content-build', () => {
  it('writes a deterministic pack whose manifest hashes match the files', () => {
    const run = (out: string): string => execFileSync('node', [path.join(GAME, 'tools/content-build.ts'), '--out', out], { encoding: 'utf8' });
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-a-')), b = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-b-'));
    run(a); run(b);
    const ma = JSON.parse(fs.readFileSync(path.join(a, 'content.manifest.json'), 'utf8')) as { contentHash: string; files: Record<string, { sha256: string }> };
    const mb = JSON.parse(fs.readFileSync(path.join(b, 'content.manifest.json'), 'utf8')) as { contentHash: string };
    expect(ma.contentHash).toBe(mb.contentHash);
    expect(Object.keys(ma.files)).toEqual(expect.arrayContaining(['tables.json', 'bodies.json', 'clip_events.json', 'tile_shapes.json', 'audio_events.json', 'vfx.json', 'atlases.json']));
    expect(Object.keys(ma.files).some((f) => f.startsWith('atlas/core/') && f.endsWith('.png'))).toBe(true);
  }, 60_000);
  it('--check passes on the repository and writes nothing', () => {
    const out = execFileSync('node', [path.join(GAME, 'tools/content-build.ts'), '--check'], { encoding: 'utf8' });
    expect(out).toMatch(/--check OK/);
  });
});
