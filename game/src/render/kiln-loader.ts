// Kiln -> Phaser loader (plan E0.3, first slice): loads the mobile atlas pages as Phaser atlases and answers
// "which page holds frame X". The animator builds clips from the frame names. Pivot comes from the contract
// (pivot pixel on the frame; world position = pivot).
import type Phaser from 'phaser';

/** Pages of assets/atlases/mobile. A test compares this with the files on disk. */
export const KILN_PAGE_COUNT = 7;
export const KILN_BASE = 'assets/atlases/mobile';
const pageKey = (i: number): string => `kiln-${i}`;

export function preloadKiln(scene: Phaser.Scene): void {
  for (let i = 0; i < KILN_PAGE_COUNT; i++) scene.load.atlas(pageKey(i), `${KILN_BASE}/atlas-${i}.png`, `${KILN_BASE}/atlas-${i}.json`);
}

export class KilnFrames {
  private readonly page = new Map<string, string>();
  constructor(scene: Phaser.Scene) {
    for (let i = 0; i < KILN_PAGE_COUNT; i++) {
      const tex = scene.textures.get(pageKey(i));
      for (const name of tex.getFrameNames()) this.page.set(name, pageKey(i));
    }
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
}

/** Phaser origin that puts the pivot PIXEL of a frame on the sprite position (pixel centre). */
export function originOf(frameSize: readonly [number, number], pivot: readonly [number, number]): { x: number; y: number } {
  return { x: (pivot[0] + 0.5) / frameSize[0], y: (pivot[1] + 0.5) / frameSize[1] };
}
