// Pure (no Phaser) index of Kiln frame names: `${group}/${asset}/${clip}[_${direction}]_${n}` (vfx: `vfx/${clip}_${n}`, no asset level). A "clip" here is one
// (asset, clip, direction) run of numbered frames; the shipped core atlas has 2976 frames and 467 such clips, the same
// counts the Studio's Phaser export check reports (docs/STUDIO_EXPORT_VERIFICATION.md).
export type Direction = 'south' | 'east' | 'north' | 'west';
const DIRS: ReadonlySet<string> = new Set(['south', 'east', 'north', 'west']);

export interface FrameName { group: string; asset: string; clip: string; direction: Direction | null; index: number }

export function parseFrameName(name: string): FrameName | null {
  const m = /^([^/]+)\/(?:([^/]+)\/)?(.+)_(\d+)$/.exec(name);
  if (!m) return null;
  const body = m[3]!;
  const cut = body.lastIndexOf('_');
  const tail = cut >= 0 ? body.slice(cut + 1) : '';
  const hasDir = DIRS.has(tail);
  return { group: m[1]!, asset: m[2] ?? '', clip: hasDir ? body.slice(0, cut) : body, direction: hasDir ? (tail as Direction) : null, index: Number(m[4]) };
}

export interface ClipInfo { key: string; asset: string; clip: string; direction: Direction | null; frames: string[] }

/** Group frame names into clips, frames in index order. Names that do not parse are returned in `unparsed`. */
export function indexClips(names: Iterable<string>): { clips: Map<string, ClipInfo>; unparsed: string[] } {
  const parts = new Map<string, { info: ClipInfo; idx: [number, string][] }>();
  const unparsed: string[] = [];
  for (const n of names) {
    const p = parseFrameName(n);
    if (!p) { unparsed.push(n); continue; }
    const key = n.slice(0, n.lastIndexOf('_'));
    let e = parts.get(key);
    if (!e) { e = { info: { key, asset: p.asset ? `${p.group}/${p.asset}` : p.group, clip: p.clip, direction: p.direction, frames: [] }, idx: [] }; parts.set(key, e); }
    e.idx.push([p.index, n]);
  }
  const clips = new Map<string, ClipInfo>();
  for (const [key, e] of parts) { e.idx.sort((a, b) => a[0] - b[0]); e.info.frames = e.idx.map((x) => x[1]); clips.set(key, e.info); }
  return { clips, unparsed };
}

/** Phaser `anims.fromJSON` document for the clips, one animation per clip key. `textureOf` maps a frame to its atlas page key. */
export function animsJson(clips: Iterable<ClipInfo>, textureOf: (frame: string) => string, fps: (clip: string) => number): { anims: object[]; globalTimeScale: number } {
  const anims: object[] = [];
  for (const c of clips) {
    anims.push({ key: c.key, type: 'frame', frameRate: fps(c.clip), repeat: /^(idle|run|move|walk|loop|hover)/.test(c.clip) ? -1 : 0, frames: c.frames.map((f) => ({ key: textureOf(f), frame: f })) });
  }
  return { anims, globalTimeScale: 1 };
}

export interface Pivot { x: number; y: number }
export interface RuntimeEntry { canvas: [number, number]; facings: Record<string, { source: string; flip_x: boolean; anchor_px: [number, number] }>; anchor_px: [number, number] }
export type RuntimeTable = Record<string, RuntimeEntry>;

/** Pivot pixel of a frame: the per-asset anchor from mob-runtime.json (per facing, mirrored for west), else bottom-centre of the frame. */
export function pivotFor(table: RuntimeTable | null, asset: string, direction: Direction | null, frameW: number, frameH: number): Pivot {
  const kind = asset.split('/').pop() ?? asset;
  const e = table?.[kind];
  if (e) {
    const f = direction ? e.facings[direction] : undefined;
    const a = f?.anchor_px ?? e.anchor_px;
    return { x: a[0], y: a[1] };
  }
  return { x: Math.floor(frameW / 2), y: frameH - 1 };
}
