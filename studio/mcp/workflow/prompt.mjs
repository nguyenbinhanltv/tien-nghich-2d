// Prompt conventions for image-sheet prompts, so every sheet prompt says the same things in the same order:
//   1. the role of each reference image, by position (Image 1, Image 2);
//   2. the layout of the sheet as percentages of a cell;
//   3. each facing said three ways (where it looks, which edge it points to, which view it is);
//   4. which limbs are near and far, and where the character's left and right appear;
//   5. the locked reference description, pasted verbatim, when the asset has one;
//   6. the proportions text from the pack, and the pack's style words.
// Nothing project-specific is written here: style words, proportions and reference text arrive as arguments from the pack.
import { createHash } from 'node:crypto';

const FACING = {
  south: { looks: 'toward the viewer', edge: 'toward the bottom edge of its cell', view: 'a front view',
    limbs: "the character's RIGHT arm and leg appear on the viewer's LEFT, its LEFT arm and leg on the viewer's RIGHT; both sides are equally near" },
  west: { looks: "toward the viewer's left", edge: 'toward the left edge of its cell', view: "a left-facing profile, 3/4 from above",
    limbs: "the NEAR limbs (toward the viewer) are the character's LEFT arm and leg, the FAR limbs are its RIGHT arm and leg, half hidden behind the body" },
  north: { looks: 'away from the viewer', edge: 'toward the top edge of its cell', view: 'a back view',
    limbs: "the character's LEFT arm and leg appear on the viewer's LEFT, its RIGHT arm and leg on the viewer's RIGHT; both sides are equally near" },
  east: { looks: "toward the viewer's right", edge: 'toward the right edge of its cell', view: "a right-facing profile, 3/4 from above",
    limbs: "the NEAR limbs (toward the viewer) are the character's RIGHT arm and leg, the FAR limbs are its LEFT arm and leg, half hidden behind the body" },
};

export const facingNames = Object.keys(FACING);
const pct = (v) => `${Math.round(v * 100)}%`;
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** One facing, said three ways. */
export function facingLine(facing) {
  const f = FACING[facing];
  return f ? `${facing.toUpperCase()}: the figure looks ${f.looks}, its nose or front points ${f.edge}, drawn as ${f.view}.` : null;
}

/** Near and far limbs of one facing. */
export function limbLine(facing) {
  const f = FACING[facing];
  return f ? `${facing.toUpperCase()}: ${f.limbs}.` : null;
}

/**
 * The prompt skeleton for a sheet. `layout` is a forge layout, `reference` a pack reference entry (or null), `style` the pack's
 * agentGuidance.prompt, `proportions` the figure guide text (or '').
 * Returns {text, imageRoles, conventions: {...}}.
 */
export function buildPrompt({ layout, nativePx, poses, reference = null, referenceName = null, style = {}, proportions = '' }) {
  const facings = [...new Set(layout.cells.map((c) => c.facing).filter(Boolean))];
  const columns = new Set(layout.cells.map((c) => c.rect[0])).size, rows = new Set(layout.cells.map((c) => c.rect[1])).size;
  const first = layout.cells[0], lm = first.landmarks;
  const basis = layout.landmarkBasis === 'cell_width' ? 'width' : 'height';
  const label = layout.labelBand.fraction, ground = layout.ground.fraction;
  const imageRoles = [
    { position: 1, role: 'sheet template', use: `Draw ON this image: pure green key background, ${columns} by ${rows} cells, a dim guide in each cell. Keep the cell grid; do not draw the labels or the guide.` },
    ...(reference ? [{ position: 2, role: `locked reference of ${referenceName}`, use: 'The approved look of this character. Match its design, colours and marks; do NOT copy its pose, layout, scale or its sprite-sheet arrangement.' }] : []),
  ];
  const lines = [];
  lines.push(`Create one ${layout.size.join('x')} px character sheet on a solid uniform chroma-key green ${layout.key.rgb.length === 3 ? '#' + layout.key.rgb.map((v) => v.toString(16).padStart(2, '0')).join('') : ''} background: ${columns} columns by ${rows} rows of equal cells, no dividers, no shadows, no scenery, no extra writing.`);
  lines.push('REFERENCE IMAGES BY POSITION: ' + imageRoles.map((r) => `Image ${r.position} is the ${r.role}: ${r.use}`).join(' '));
  lines.push(`FRAMING (percent of one cell): the top ${pct(label)} is the label band and stays empty; one isolated full figure per cell, centred horizontally at about ${pct(lm.centerX)} of the cell ${basis === 'width' ? 'width' : 'height'}, its feet on the ground line at ${pct(ground)} of the cell height, the whole figure between about ${pct(label + 0.06)} and ${pct(ground)} of the cell height and inside the middle 84% of the cell width; nothing touches a cell edge. It will be reduced to ${nativePx.join('x')} px, so keep every shape bold.`);
  lines.push('FACINGS (each said three ways): ' + facings.map(facingLine).filter(Boolean).join(' '));
  if (poses?.length) lines.push(`POSES: each row is one key pose of one clip, in this order: ${poses.join(', ')}. Every cell of a facing keeps the same character, scale and ground line; only the pose changes.`);
  lines.push('NEAR AND FAR LIMBS: ' + facings.map(limbLine).filter(Boolean).join(' ') + ' Keep the character one design in all views; left and right marks swap sides correctly between views.');
  lines.push(reference
    ? `CHARACTER (locked reference "${referenceName}", pasted verbatim, do not reword): ${reference.description}`
    : 'CHARACTER: <describe the character here: species or role, outfit, one or two asymmetric marks stated as LEFT or RIGHT of the character, colours by palette hex>');
  if (proportions) lines.push(`PROPORTIONS: ${proportions}`);
  const styleLine = [style.style, style.camera && `Camera: ${style.camera}.`, style.light && `Lighting: ${style.light}.`].filter(Boolean).join(' ');
  if (styleLine) lines.push(`STYLE: ${styleLine}`);
  return {
    text: lines.join('\n\n'), imageRoles,
    conventions: { referenceImagesByPosition: true, facingsSaidThreeWays: true, framingAsCellPercentages: true, nearFarLimbsNamed: true, referencePastedVerbatim: Boolean(reference) },
  };
}

/** Did the prompt the agent sent carry the locked description verbatim (whitespace-insensitive)? */
export function carriesVerbatim(prompt, description) {
  const squash = (s) => s.replace(/\s+/g, ' ').trim();
  return squash(prompt).includes(squash(description));
}
