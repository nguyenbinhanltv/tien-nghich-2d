// Rig document validation: JSON schema first, then the cross-field rules the schema cannot express.
import { readFileSync } from 'node:fs';
import { validateSchema } from '../../core/json-schema.mjs';
import { bodyPlans } from '../motion/library.mjs';
import { polygonMask } from './raster.mjs';

export const rigSchema = () => JSON.parse(readFileSync(new URL('rig.schema.json', import.meta.url), 'utf8'));

/** Validate a rig. `palette` (from makePalette) checks colour ids. Returns a list of issue strings. */
export function validateRig(rig, {palette} = {}) {
  const issues = validateSchema(rigSchema(), rig);
  if (issues.length) return issues;
  const plan = bodyPlans()[rig.bodyPlan];
  if (!plan) return [`bodyPlan: unknown body plan "${rig.bodyPlan}"`];
  const [width, height] = rig.canvas;
  const inside = ([x, y]) => x >= 0 && y >= 0 && x < width && y < height;
  const boxOk = (at, [x0, y0, x1, y1]) => { if (x0 >= x1 || y0 >= y1 || x0 < 0 || y0 < 0 || x1 > width || y1 > height) issues.push(`${at}: box must be a non-empty half-open box inside the canvas`); };
  const colorOk = (at, id) => { if (palette && !palette.has(id)) issues.push(`${at}: unknown palette id "${id}"`); };
  if (!inside(rig.pivot)) issues.push('pivot: outside the canvas');
  for (const [name, facing] of Object.entries(rig.facings)) {
    const at = `facings.${name}`;
    if (facing.mirrorOf) {
      if (!rig.facings[facing.mirrorOf]) issues.push(`${at}.mirrorOf: no such facing "${facing.mirrorOf}"`);
      else if (rig.facings[facing.mirrorOf].mirrorOf) issues.push(`${at}.mirrorOf: cannot mirror a facing that is itself a mirror`);
      if (facing.parts) issues.push(`${at}: a mirrored facing must not declare parts`);
      for (const [from, to] of Object.entries(facing.swapColors ?? {})) { colorOk(`${at}.swapColors`, from); colorOk(`${at}.swapColors`, to); }
    } else {
      if (!facing.forward || !facing.parts) { issues.push(`${at}: a facing needs forward and parts (or mirrorOf)`); continue; }
      if (Math.abs(facing.forward[0]) + Math.abs(facing.forward[1]) !== 1) issues.push(`${at}.forward: must be one of [1,0], [-1,0], [0,1], [0,-1]`);
      const ids = new Set();
      let bodies = 0;
      facing.parts.forEach((part, k) => {
        const pat = `${at}.parts[${k}] (${part.id})`;
        if (ids.has(part.id)) issues.push(`${pat}: duplicate part id`);
        ids.add(part.id);
        const role = plan.roles[part.role];
        if (!role) { issues.push(`${pat}: role "${part.role}" is not in the ${rig.bodyPlan} body plan`); return; }
        if (part.role === 'body') {
          bodies++;
          if (part.cut || part.remove || part.contact) issues.push(`${pat}: the body plate is the remainder and takes no cut, remove or contact`);
          return;
        }
        if (!part.cut || !part.remove) issues.push(`${pat}: needs cut and remove polygons`);
        for (const key of ['cut', 'remove']) for (const p of part[key] ?? []) if (p[0] < -1 || p[1] < -1 || p[0] > width || p[1] > height) issues.push(`${pat}.${key}: point ${JSON.stringify(p)} is far outside the canvas`);
        if (role.contact && !part.contact) issues.push(`${pat}: role "${part.role}" needs a contact point`);
        if (!role.contact && part.contact) issues.push(`${pat}: role "${part.role}" takes no contact`);
        if (role.contact && part.contact && part.cut) {
          const mask = polygonMask(width, height, part.cut);
          if (!inside(part.contact) || !mask[part.contact[1] * width + part.contact[0]]) issues.push(`${pat}.contact: ${JSON.stringify(part.contact)} is outside the part's cut polygon`);
        }
        if (role.rotates && part.swing !== undefined && !part.joint) issues.push(`${pat}: swing needs a joint`);
        if (role.rotates && !part.joint) issues.push(`${pat}: rotating role "${part.role}" needs a joint`);
      });
      if (bodies !== 1) issues.push(`${at}: needs exactly one body part, found ${bodies}`);
      const last = facing.parts[facing.parts.length - 1];
      if (last && last.role !== 'body') issues.push(`${at}: the body part must be last in draw order (parts are listed back to front)`);
      for (const [role, spec] of Object.entries(plan.roles)) {
        const count = facing.parts.filter(p => p.role === role).length;
        if (spec.required && count < (spec.min ?? 1)) issues.push(`${at}: body plan ${rig.bodyPlan} needs ${spec.min ?? 1}+ "${role}" part(s), found ${count}`);
        if (spec.max !== undefined && count > spec.max) issues.push(`${at}: at most ${spec.max} "${role}" part(s)`);
      }
    }
    for (const mark of facing.landmarks ?? []) {
      const mat = `${at}.landmarks.${mark.id}`;
      boxOk(mat, mark.box);
      if (mark.color) colorOk(mat, mark.color);
      if (mark.fallback) colorOk(mat, mark.fallback);
      if (mark.expect === 'absent' && mark.pixels?.length) issues.push(`${mat}: an absent landmark has no pixels`);
      if (mark.follows && !(facing.parts ?? rig.facings[facing.mirrorOf]?.parts ?? []).some(p => p.id === mark.follows)) issues.push(`${mat}: follows unknown part "${mark.follows}"`);
      if (!mark.color) issues.push(`${mat}: needs a colour (the dedicated marker colour)`);
      for (const p of mark.pixels ?? []) if (p[0] < mark.box[0] || p[0] >= mark.box[2] || p[1] < mark.box[1] || p[1] >= mark.box[3]) issues.push(`${mat}: pixel ${JSON.stringify(p)} lies outside its box`);
    }
    for (const feature of facing.features ?? []) boxOk(`${at}.features.${feature.id}`, feature.box);
  }
  return issues;
}
