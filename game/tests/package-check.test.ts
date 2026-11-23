import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GAME } from '../tools/lib/repo.ts';
import { checkChunks, checkContentPack, checkWeb, readBudget } from '../tools/lib/package-check.ts';

let dist = '', pack = '';
const copy = (src: string): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-')); fs.cpSync(src, d, { recursive: true }); return d; };
const manifest = (d: string): { files: Record<string, { sha256: string; bytes: number }> } => JSON.parse(fs.readFileSync(path.join(d, 'content.manifest.json'), 'utf8')) as never;

beforeAll(() => {
  execFileSync(path.join(GAME, 'node_modules/.bin/vite'), ['build', '--emptyOutDir'], { cwd: GAME, stdio: 'ignore' });
  dist = copy(path.join(GAME, 'dist'));
  pack = fs.mkdtempSync(path.join(os.tmpdir(), 'pk-pack-'));
  execFileSync('node', [path.join(GAME, 'tools/content-build.ts'), '--out', pack], { cwd: GAME, stdio: 'ignore' });
}, 120_000);

describe('E9.4 package checks on the real build', () => {
  it('the web build, content pack and atlas chunks are inside their budgets', () => {
    expect(checkWeb(dist)).toEqual([]);
    expect(checkContentPack(pack)).toEqual([]);
    expect(checkChunks()).toEqual([]);
  });
  it('the budget file covers every longtime chunk the repository has', () => {
    const b = readBudget();
    expect(Object.keys(b.chunks).sort()).toEqual(['abode', 'armory', 'ember_delta', 'forms', 'interface', 'mist_archive', 'star_quarry', 'trial', 'wards']);
  });
});

describe('E9.4 the checks catch a bad package', () => {
  it('a missing referenced file, an unprecached file and a precached file that is gone', () => {
    const d = copy(dist);
    fs.rmSync(path.join(d, 'icons/icon-192.png'));
    fs.writeFileSync(path.join(d, 'fonts/extra.woff2'), 'x');
    const e = checkWeb(d).join('\n');
    expect(e).toMatch(/index\.html references icons\/icon-192\.png/);
    expect(e).toMatch(/manifest icon icons\/icon-192\.png is not in the build/);
    expect(e).toMatch(/sw\.js precaches icons\/icon-192\.png/);
    expect(e).toMatch(/fonts\/extra\.woff2 is in the build but not precached/);
  });
  it('a source map, a stray top-level folder, a leaked local path and a studio file', () => {
    const d = copy(dist);
    const js = fs.readdirSync(path.join(d, 'assets')).find((f) => f.endsWith('.js'))!;
    fs.writeFileSync(path.join(d, 'assets', `${js}.map`), '{}');
    fs.mkdirSync(path.join(d, 'secrets')); fs.writeFileSync(path.join(d, 'secrets/a.json'), '{}');
    fs.appendFileSync(path.join(d, 'assets', js), '\n// built in /Users/someone/project\n');
    fs.mkdirSync(path.join(d, 'assets/studio')); fs.writeFileSync(path.join(d, 'assets/studio/x.js'), '');
    const e = checkWeb(d).join('\n');
    expect(e).toMatch(/\.map: source map shipped/);
    expect(e).toMatch(/secrets\/a\.json: unexpected top-level entry secrets/);
    expect(e).toMatch(/contains a local path \(\/Users\/someone/);
    expect(e).toMatch(/assets\/studio\/x\.js: must not be in a build/);
  });
  it('a portrait manifest, an absolute start_url and an over-size JS bundle', () => {
    const d = copy(dist);
    const mp = path.join(d, 'manifest.webmanifest'), m = JSON.parse(fs.readFileSync(mp, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(mp, JSON.stringify({ ...m, orientation: 'portrait', start_url: '/' }));
    const e = checkWeb(d, { ...readBudget(), web: { ...readBudget().web, jsGzipKiB: 10 } }).join('\n');
    expect(e).toMatch(/orientation is portrait, the game is landscape only/);
    expect(e).toMatch(/start_url \/ must be relative/);
    expect(e).toMatch(/JS is \d+ KiB gzipped, over the 10 KiB budget/);
  });
  it('an atlas page that differs from the Kiln source is flagged', () => {
    const d = copy(dist);
    fs.appendFileSync(path.join(d, 'assets/atlases/mobile/atlas-0.png'), 'x');
    expect(checkWeb(d).join('\n')).toMatch(/atlas-0\.png: differs from the Kiln source page/);
  });
  it('a content file edited after the manifest was written, a missing file and an extra file', () => {
    const d = copy(pack);
    const names = Object.keys(manifest(d).files);
    fs.appendFileSync(path.join(d, 'tables.json'), ' ');
    fs.rmSync(path.join(d, 'locale/vi.json'));
    fs.writeFileSync(path.join(d, 'stray.json'), '{}');
    const e = checkContentPack(d).join('\n');
    expect(names).toContain('tables.json');
    expect(e).toMatch(/tables\.json is \d+ bytes, manifest says/);
    expect(e).toMatch(/tables\.json does not match its sha256/);
    expect(e).toMatch(/locale\/vi\.json is listed in the manifest but missing/);
    expect(e).toMatch(/stray\.json is in the pack but not in the manifest/);
  });
  it('a tampered contentHash and a pack over its size budget', () => {
    const d = copy(pack);
    const mp = path.join(d, 'content.manifest.json'), m = JSON.parse(fs.readFileSync(mp, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(mp, JSON.stringify({ ...m, contentHash: '0'.repeat(64) }));
    expect(checkContentPack(d, { ...readBudget(), contentPack: { totalMiB: 0.1 } }).join('\n')).toMatch(/contentHash does not match[\s\S]*over the 0\.1 MiB budget/);
  });
  it('a chunk over its page or MiB cap, and a chunk with no budget', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-'));
    const mk = (name: string, pages: { width: number; height: number }[]): void => { fs.mkdirSync(path.join(root, name)); fs.writeFileSync(path.join(root, name, 'chunk-manifest.json'), JSON.stringify({ pages, page_count: pages.length })); };
    mk('abode', [{ width: 1024, height: 1024 }, { width: 1024, height: 1024 }]); // 2 pages, 8 MiB: over 1 / 4
    mk('mystery', [{ width: 16, height: 16 }]);
    const e = checkChunks(root).join('\n');
    expect(e).toMatch(/chunk abode: 2 pages, cap 1/);
    expect(e).toMatch(/chunk abode: 8\.00 MiB decompressed, cap 4 MiB/);
    expect(e).toMatch(/chunk mystery: no budget/);
    expect(e).toMatch(/chunk trial: has a budget but no chunk-manifest\.json/);
  });
});
