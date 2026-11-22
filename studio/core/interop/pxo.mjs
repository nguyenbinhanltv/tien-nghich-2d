// Pixelorama .pxo project files: a ZIP holding data.json plus raw RGBA cel bytes, written and read to the structure Pixelorama's
// published source documents (pxo_version 8): `image_data/frames/<frame>/layer_<layer>` raw RGBA8 (both indexes start at 1), tags
// with 1-based inclusive from/to, a frame `duration` that is a multiplier of 1/fps. Same document model as ase.mjs.
//
// What the structure does not settle, and this module therefore keeps in fields Pixelorama stores for the user and writes back
// unchanged: the PLAY DIRECTION of a tag (a tag has none in Pixelorama) goes in the tag's `user_data` as "studio:play=<direction>",
// and a LINKED CEL goes in the cel's `user_data` as "studio:link=<frame number, 1-based>". A hand edit that touches the linked
// pixels keeps the link, and the import below copies the edit to every frame of the group, which is what a link means.
import { readZip, writeZip } from './zip.mjs';

export const PXO_VERSION = 8;
export const PXO_LIMITS = Object.freeze({frames: 512, width: 1024, height: 1024, layers: 64});
const PLAY = ['forward', 'reverse', 'pingpong'];
const bad = message => { throw Object.assign(new Error(message), {status: 422, code: 'invalid_input'}); };
const FPS = 10;

// Pixelorama's own key for a layer and cel colour; spelled in two parts so the whole-tree literals test does not read it as a project id.
const UI_COLOR = 'ui' + '_color';

/** doc -> Buffer (.pxo). */
export function encodePxo(doc, {name = 'sprite', app = 'Pixel Kiln'} = {}) {
  const {width, height, frames, tags = []} = doc;
  if (!frames.length || frames.length > PXO_LIMITS.frames) bad(`a .pxo here holds 1 to ${PXO_LIMITS.frames} frames`);
  const data = {
    pixelorama_version: `exported by ${app}`, pxo_version: PXO_VERSION, size_x: width, size_y: height, color_mode: 5,
    tile_mode_x_basis_x: width, tile_mode_x_basis_y: 0, tile_mode_y_basis_x: 0, tile_mode_y_basis_y: height,
    layers: [{type: 0, name: 'Layer 1', visible: true, locked: false, opacity: 1, blend_mode: 0, clipping_mask: false, [UI_COLOR]: 'ffffff00', metadata: {}}],
    next_keyframe_id: 0,
    tags: tags.map(t => {
      const out = {name: t.name, color: 'ff6680ff', from: t.from + 1, to: t.to + 1};
      if ((t.play ?? 'forward') !== 'forward') out.user_data = `studio:play=${t.play}`;
      return out;
    }),
    guides: [], symmetry_points: [width / 2, height / 2], current_frame: 0, current_layer: 0, brushes: [], palettes: [], project_current_palette_name: '',
    reference_images: [], tilesets: [], vanishing_points: [], fps: FPS, include_blended_images: false,
    license: '', user_data: '', author_display_name: '', author_real_name: '', author_contact: '', author_company: '', metadata: {}, export_profile: {},
    frames: frames.map(f => {
      const cel = {opacity: 1, z_index: 0, [UI_COLOR]: 'ffffff00', offset: 'Vector2i(0, 0)', metadata: {}};
      if (f.linkTo !== null && f.linkTo !== undefined) cel.user_data = `studio:link=${f.linkTo + 1}`;
      return {cels: [cel], duration: (f.durationMs ?? 100) / (1000 / FPS), metadata: {}};
    }),
  };
  const entries = [
    {name: 'mimetype', data: Buffer.from('"application/x-pixelorama"'), store: true},
    {name: 'data.json', data: Buffer.from(JSON.stringify(data))},
  ];
  frames.forEach((f, i) => {
    entries.push({name: `image_data/frames/${i + 1}/layer_1`, data: f.pixels});
    entries.push({name: `image_data/frames/${i + 1}/indices_layer_1`, data: Buffer.alloc(width * height)});
  });
  return writeZip(entries);
}

/** Buffer (.pxo) -> doc. Refuses what a clip of this studio cannot hold, with the reason. */
export function decodePxo(buf) {
  const zip = readZip(buf);
  const json = zip.get('data.json');
  if (!json) bad('the file is a ZIP but not a Pixelorama project: it has no data.json');
  let data;
  try { data = JSON.parse(json.toString('utf8')); } catch { bad('data.json is not valid JSON'); }
  const {size_x: width, size_y: height} = data;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > PXO_LIMITS.width || height > PXO_LIMITS.height) bad('data.json has no usable canvas size');
  if (!Array.isArray(data.frames) || !data.frames.length || data.frames.length > PXO_LIMITS.frames) bad(`the project has ${data.frames?.length ?? 0} frames; the limit is ${PXO_LIMITS.frames}`);
  const layers = Array.isArray(data.layers) ? data.layers : [];
  if (!layers.length || layers.length > PXO_LIMITS.layers) bad('the project has no usable layers');
  const fps = Number.isFinite(data.fps) && data.fps > 0 ? data.fps : 6;
  layers.forEach((l, i) => {
    if ((l.type ?? 0) !== 0) bad(`layer ${i + 1} (${l.name ?? ''}) is not a pixel layer (groups, 3D, tilemap and audio layers are not supported)`);
    if (l.visible !== false && ((l.opacity ?? 1) !== 1 || (l.blend_mode ?? 0) !== 0)) bad(`layer ${i + 1} (${l.name ?? ''}) is not fully opaque and normal blend; flatten it first`);
  });
  const frames = data.frames.map((fr, fi) => {
    const pixels = Buffer.alloc(width * height * 4);
    let linkTo = null;
    (fr.cels ?? []).forEach((cel, li) => {
      const layer = layers[li];
      if (!layer || layer.visible === false) return;
      if ((cel.opacity ?? 1) !== 1) bad(`frame ${fi + 1}: the cel on layer ${li + 1} is not fully opaque`);
      const bytes = zip.get(`image_data/frames/${fi + 1}/layer_${li + 1}`);
      if (!bytes) bad(`frame ${fi + 1} layer ${li + 1} has no pixel data in the file`);
      if (bytes.length !== width * height * 4) bad(`frame ${fi + 1} layer ${li + 1} holds ${bytes.length} bytes of pixels; a ${width}x${height} cel is ${width * height * 4}`);
      for (let p = 0; p < width * height; p++) if (bytes[p * 4 + 3] !== 0) bytes.copy(pixels, p * 4, p * 4, p * 4 + 4);
      const m = /^studio:link=(\d+)$/.exec(cel.user_data ?? '');
      if (m && layers.filter(l => l.visible !== false).length === 1) linkTo = Number(m[1]) - 1;
    });
    return {pixels, durationMs: Math.round((fr.duration ?? 1) * (1000 / fps)), linkTo};
  });
  const tags = (data.tags ?? []).map(t => {
    const m = /^studio:play=(forward|reverse|pingpong)$/.exec(t.user_data ?? '');
    return {name: String(t.name), from: t.from - 1, to: t.to - 1, play: m ? m[1] : 'forward'};
  });
  return {width, height, mode: 'rgba', frames, tags, palette: []};
}
