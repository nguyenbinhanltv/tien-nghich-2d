// Clip viewer (E0.3 "definition of done": one scene shows every clip of one mob). Open with ?view=clips&kind=mob_blood_wolf.
// &chunk=abode&kind=longtime/lt_kiln_keeper loads a longtime chunk on demand. &page=N pages through clips that do not fit one 384x216 screen. Each clip is a Phaser animation made by anims.fromJSON from the atlas frame names; the label is the clip key.
import Phaser from 'phaser';
import { VIEW_H, VIEW_W } from '../../contracts/world.ts';
import { KilnFrames, loadChunk, originOf, preloadKiln } from '../kiln-loader.ts';

export class ClipViewerScene extends Phaser.Scene {
  private readonly kind: string;
  loadMs = 0;
  clipCount = 0;
  shown = 0;
  pages = 1;
  private readonly page: number;
  private readonly chunk: string | null;

  constructor(kind: string, page = 0, chunk: string | null = null) { super('clip-viewer'); this.kind = kind; this.page = page; this.chunk = chunk; }

  preload(): void { this.t0 = performance.now(); preloadKiln(this); }
  private t0 = 0;

  async create(): Promise<void> {
    const frames = new KilnFrames(this);
    if (this.chunk) frames.add(await loadChunk(this, this.chunk));
    this.loadMs = performance.now() - this.t0;
    this.cameras.main.setBackgroundColor('#14101a');
    const asset = this.kind.includes('/') ? this.kind : `characters/${this.kind}`;
    const clips = [...frames.clips.values()].filter((c) => c.asset === asset);
    this.clipCount = clips.length;
    if (clips.length === 0) return;
    const f0 = this.textures.getFrame(frames.pageOf(clips[0]!.frames[0]!), clips[0]!.frames[0]!);
    const cw = f0.width + 4;
    const ch = f0.height + 4;
    const cols = Math.max(1, Math.floor(VIEW_W / cw));
    const rows = Math.max(1, Math.floor(VIEW_H / ch));
    const perPage = cols * rows;
    this.pages = Math.ceil(clips.length / perPage);
    clips.slice(this.page * perPage, (this.page + 1) * perPage).forEach((c, i) => {
      const first = c.frames[0]!;
      const page = frames.pageOf(first);
      const o = originOf([f0.width, f0.height], frames.pivot(asset, c.direction, first));
      const s = this.add.sprite((i % cols) * cw + cw / 2, Math.floor(i / cols) * ch + ch - 2, page, first).setOrigin(o.x, o.y);
      s.play(c.key);
      this.shown++;
    });
  }
}
