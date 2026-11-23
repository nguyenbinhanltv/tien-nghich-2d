// Godot 4: one SpriteFrames `.tres` per asset (an AtlasTexture sub-resource per frame, one animation per clip and direction) written in the
// text resource format 3. SpriteFrames has no per-frame pivot: pivots go to a `pivots.json` beside them for use as the AnimatedSprite2D offset.
// Opened in Godot 4.7.2 (headless import, SpriteFrames loaded, every AtlasTexture compared with its page).
import { json, clipName, gcd, stem, pagesOf, byAsset } from './common.mjs';

export const id = 'godot';
export const label = {en: 'Godot 4 (SpriteFrames)', vi: 'Godot 4 (SpriteFrames)'};

const num = v => (Number.isInteger(v) ? `${v}.0` : String(+v.toFixed(6)));

export async function build(desc, {resPath = 'res://atlas'} = {}) {
  const files = [], copies = desc.pages.map(p => ({page: p.index, name: `godot/${p.image}`})), pivots = {};
  const frameOf = new Map(desc.frames.map(f => [f.key, f]));
  const assets = [...new Set(desc.clips.map(c => c.asset))];
  for (const asset of assets) {
    const clips = desc.clips.filter(c => c.asset === asset);
    const pages = pagesOf(clips.flatMap(c => c.frames.map(k => frameOf.get(k))));
    const subs = [];
    const anims = clips.map(c => {
      const list = c.frames.map(k => frameOf.get(k));
      const ms = list.map(f => f.durationMs).filter(v => v > 0);
      const base = ms.length ? ms.reduce(gcd) : 0;
      const frames = list.map(f => { const idx = subs.push(f) - 1; return `{\n"duration": ${num(base && f.durationMs > 0 ? f.durationMs / base : 1)},\n"texture": SubResource("AtlasTexture_${idx}")\n}`; });
      return `{\n"frames": [${frames.join(', ')}],\n"loop": ${c.loop === false ? 'false' : 'true'},\n"name": &"${clipName(c)}",\n"speed": ${num(base ? 1000 / base : 5)}\n}`;
    });
    const ext = pages.map((p, i) => `[ext_resource type="Texture2D" path="${resPath}/${desc.pages.find(q => q.index === p).image}" id="${i + 1}_page${p}"]`);
    const sub = subs.map((f, i) => `[sub_resource type="AtlasTexture" id="AtlasTexture_${i}"]\natlas = ExtResource("${pages.indexOf(f.page) + 1}_page${f.page}")\nregion = Rect2(${f.x}, ${f.y}, ${f.w}, ${f.h})\n`);
    const text = `[gd_resource type="SpriteFrames" load_steps=${1 + ext.length + sub.length} format=3]\n\n${ext.join('\n')}\n\n${sub.join('\n')}\n[resource]\nanimations = [${anims.join(', ')}]\n`;
    files.push({name: `godot/${stem(asset)}.tres`, data: Buffer.from(text)});
    const first = frameOf.get(clips[0].frames[0]);
    if (first?.pivotPx) pivots[asset] = first.pivotPx;
  }
  files.push({name: 'godot/pivots.json', data: json({note: 'Pivot in source pixels from the top-left of a frame; use it as the AnimatedSprite2D offset (negated, with centered off).', pivots})});
  return {files, copies, notes: [
    `Copy the .tres files and the page PNGs into the Godot project so that the PNGs are at ${resPath}/ (change \`resPath\` if they live elsewhere); Godot then shows each .tres as a SpriteFrames resource.`,
    'Each frame\'s duration is its milliseconds divided by the clip\'s greatest common step; the clip\'s `speed` is 1000 divided by that step.',
    'SpriteFrames has no pivot: the pivots are in pivots.json and must be applied by hand as the sprite offset.',
    'Frames that belong to no asset or clip are not written to a .tres.',
    'Written to the documented text format and opened in Godot 4.7.2 (see studio/README.md).']};
}
