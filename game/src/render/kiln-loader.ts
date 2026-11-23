// Kiln -> Phaser loader (plan E0.3). Loads atlas pages (core, plus on-demand chunks such as the Dong Phu "abode"),
// answers "which page holds frame X", builds Phaser animations from the frame names with `anims.fromJSON`, and gives the
// pivot of a frame (docs/KILN_GAME_CONTRACT.md: pivot pixel on the frame, world position = pivot).
import type Phaser from 'phaser';
import { animsJson, indexClips, pivotFor } from './kiln-index.ts';
import type { ClipInfo, Direction, Pivot, RuntimeTable } from './kiln-index.ts';
import { CLIP_FPS } from './animator.ts';

export interface PageSet { id: string; base: string; pages: number }
/** Core atlas pages of assets/atlases/mobile. A test compares this with the files on disk. */
export const KILN_PAGE_COUNT = 7;
export const CORE: PageSet = { id: 'core', base: 'assets/atlases/mobile', pages: KILN_PAGE_COUNT };
export const KILN_BASE = CORE.base;
export const RUNTIME_TABLE_URL = 'assets/atlases/mob-runtime.json';
export const chunkBase = (group: string): string => `assets/atlases_longtime/mobile/${group}`;
const pageKey = (set: PageSet, i: number): string => `kiln-${set.id}-${i}`;

export function preloadPages(scene: Phaser.Scene, set: PageSet): void {
  for (let i = 0; i < set.pages; i++) scene.load.atlas(pageKey(set, i), `${set.base}/atlas-${i}.png`, `${set.base}/atlas-${i}.json`);
}

/** Boot load: core pages and the mob anchor table. */
export function preloadKiln(scene: Phaser.Scene): void {
  preloadPages(scene, CORE);
  scene.load.json('kiln-runtime', RUNTIME_TABLE_URL);
}

/** Load a longtime chunk (e.g. "abode") on demand: reads its chunk-manifest for the page count, then the pages. */
export async function loadChunk(scene: Phaser.Scene, group: string): Promise<PageSet> {
  const base = chunkBase(group);
  const res = await fetch(`${base}/chunk-manifest.json`);
  if (!res.ok) throw new Error(`chunk ${group}: manifest ${res.status}`);
  const manifest = (await res.json()) as { page_count: number };
  const set: PageSet = { id: group, base, pages: manifest.page_count };
  await new Promise<void>((resolve, reject) => {
    preloadPages(scene, set);
    scene.load.once('complete', () => resolve());
    scene.load.once('loaderror', (f: { key: string }) => reject(new Error(`chunk ${group}: failed ${f.key}`)));
    scene.load.start();
  });
  return set;
}

export class KilnFrames {
  private readonly page = new Map<string, string>();
  private readonly sets: PageSet[] = [];
  readonly clips = new Map<string, ClipInfo>();
  private readonly runtime: RuntimeTable | null;
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, sets: PageSet[] = [CORE]) {
    this.scene = scene;
    this.runtime = scene.cache.json.exists('kiln-runtime') ? (scene.cache.json.get('kiln-runtime') as RuntimeTable) : null;
    for (const s of sets) this.add(s);
  }

  /** Register the frames of a loaded page set and create their animations. Returns the number of frames added. */
  add(set: PageSet): number {
    this.sets.push(set);
    const before = this.page.size;
    const names: string[] = [];
    for (let i = 0; i < set.pages; i++) {
      for (const name of this.scene.textures.get(pageKey(set, i)).getFrameNames()) {
        if (name === '__BASE') continue;
        this.page.set(name, pageKey(set, i));
        names.push(name);
      }
    }
    const { clips } = indexClips(names);
    for (const [k, c] of clips) this.clips.set(k, c);
    this.scene.anims.fromJSON(animsJson(clips.values(), (f) => this.pageOf(f), (c) => CLIP_FPS[c] ?? 8) as unknown as Phaser.Types.Animations.JSONAnimations);
    return this.page.size - before;
  }

  get size(): number { return this.page.size; }
  has(name: string): boolean { return this.page.has(name); }
  pageOf(name: string): string {
    const p = this.page.get(name);
    if (!p) throw new Error(`kiln frame not in any atlas page: ${name}`);
    return p;
  }
  /** Frames `${prefix}_0 .. _{n-1}` that exist, in order. */
  sequence(prefix: string): string[] {
    const out: string[] = [];
    for (let i = this.has(`${prefix}_0`) ? 0 : Infinity; this.has(`${prefix}_${i}`); i++) out.push(`${prefix}_${i}`);
    return out;
  }
  /** Pivot pixel of a frame (x, y from the top-left of the frame). */
  pivot(asset: string, direction: Direction | null, frame: string): Pivot {
    const f = this.scene.textures.getFrame(this.pageOf(frame), frame);
    return pivotFor(this.runtime, asset, direction, f.width, f.height);
  }
}

/** Phaser origin that puts the pivot PIXEL of a frame on the sprite position (pixel centre). */
export function originOf(frameSize: readonly [number, number], pivot: Pivot): { x: number; y: number } {
  return { x: (pivot.x + 0.5) / frameSize[0], y: (pivot.y + 0.5) / frameSize[1] };
}
