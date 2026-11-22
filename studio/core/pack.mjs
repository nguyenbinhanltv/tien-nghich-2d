// Project pack: loader and validator. A pack is one JSON file (studio.project.json by default)
// that holds everything project-specific; the core never names a project path or asset itself.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSchema } from './json-schema.mjs';

export const packFileName = 'studio.project.json';
export const packSchemaPath = fileURLToPath(new URL('../schemas/project.schema.json', import.meta.url));

let schemaCache;
function schema() {
  return schemaCache ??= JSON.parse(fs.readFileSync(packSchemaPath, 'utf8'));
}

function packError(issues) {
  return Object.assign(new Error('Invalid project pack:\n  ' + issues.join('\n  ')), {code: 'invalid_pack', issues});
}

// A relative path that stays inside the project root, with no drive, no "..", no empty parts.
export function isRootRelative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || /^[A-Za-z]:|\\/.test(value)) return false;
  return value.split('/').every(part => part && part !== '.' && part !== '..');
}

const placeholders = template => [...template.matchAll(/\{([A-Za-z_]+)\}/g)].map(m => m[1]);

function pathFields(pack) {
  const fields = [['palette.file', pack.palette?.file], ['editable.overlay', pack.editable?.overlay]];
  for (const group of ['raw', 'processed', 'atlases', 'fixtures'])
    for (const [name, value] of Object.entries(pack.directories?.[group] ?? {})) fields.push([`directories.${group}.${name}`, value]);
  (pack.catalog?.sources ?? []).forEach((s, i) => {
    if (s.atlas) fields.push([`catalog.sources[${i}].atlas.dir`, s.atlas.dir]);
    for (const [name, value] of Object.entries(s.evidence ?? {})) fields.push([`catalog.sources[${i}].evidence.${name}`, value]);
  });
  fields.push(['directories.revisions', pack.directories?.revisions], ['directories.approvals', pack.directories?.approvals]);
  (pack.serve?.mounts ?? []).forEach((m, i) => fields.push([`serve.mounts[${i}].dir`, m.dir]));
  (pack.serve?.hooks ?? []).forEach((h, i) => fields.push([`serve.hooks[${i}].module`, h.module]));
  (pack.catalog?.sources ?? []).forEach((s, i) => fields.push([`catalog.sources[${i}].file`, s.file]));
  fields.push(['adapters.interpreter.command', pack.adapters?.interpreter?.command]);
  for (const [name, command] of Object.entries(pack.adapters?.commands ?? {})) fields.push([`adapters.commands.${name}.script`, command.script]);
  for (const [name, generator] of Object.entries(pack.adapters?.generators ?? {})) fields.push([`adapters.generators.${name}.script`, generator.script]);
  const vfx = pack.adapters?.vfx;
  if (vfx) {
    fields.push(['adapters.vfx.interpreter.command', vfx.interpreter.command], ['adapters.vfx.clone', vfx.clone]);
    for (const [name, file] of Object.entries(vfx.palettes)) fields.push([`adapters.vfx.palettes.${name}`, file]);
  }
  return fields.filter(([, value]) => value !== undefined);
}

/** Static checks of a parsed pack (schema plus cross-field rules). Returns a list of issues. */
export function validatePack(pack) {
  const issues = validateSchema(schema(), pack);
  if (issues.length) return issues;
  for (const [where, value] of pathFields(pack))
    if (!isRootRelative(value)) issues.push(`${where}: must be a relative path inside the project, got ${JSON.stringify(value)}`);
  if (/^\.+$/.test(pack.directories.revisions)) issues.push('directories.revisions: must be a real directory name');
  for (const [name, spec] of Object.entries(pack.sizeClasses)) {
    const ranged = spec.min && spec.max;
    if (!spec.sizes && !ranged) issues.push(`sizeClasses.${name}: needs "sizes" or both "min" and "max"`);
    if (spec.sizes && ranged) issues.push(`sizeClasses.${name}: use either "sizes" or "min"/"max", not both`);
    if (ranged && (spec.min[0] > spec.max[0] || spec.min[1] > spec.max[1])) issues.push(`sizeClasses.${name}: min exceeds max`);
  }
  for (const [name, template] of Object.entries(pack.frameKeys))
    for (const required of ['id', 'n'])
      if (!placeholders(template).includes(required)) issues.push(`frameKeys.${name}: template needs {${required}}`);
  const sources = new Map();
  pack.catalog.sources.forEach((source, i) => {
    if (sources.has(source.id)) issues.push(`catalog.sources[${i}]: duplicate id "${source.id}"`);
    sources.set(source.id, source);
    if (source.effects && source.kind !== 'design-manifest') issues.push(`catalog.sources[${i}]: "effects" only applies to design-manifest`);
  });
  pack.editable.groups.forEach((group, i) => {
    const where = `editable.groups[${i}]`;
    const source = sources.get(group.source);
    const wanted = {'asset-animations': ['asset-manifest'], 'vfx-descriptor': ['vfx-index'],
      'processed-frames': ['asset-manifest', 'design-manifest']}[group.kind];
    if (!source) issues.push(`${where}: unknown catalog source "${group.source}"`);
    else if (!wanted.includes(source.kind)) issues.push(`${where}: kind "${group.kind}" needs a ${wanted.join(' or ')} source`);
    if (group.kind === 'processed-frames') {
      if (source && !source.processed) issues.push(`${where}: processed-frames needs a source with a "processed" directory key`);
      if (group.pivot?.from === 'file' && !(group.pivot.file && group.pivot.field)) issues.push(`${where}: pivot from "file" needs "file" and "field"`);
      if (group.pivot?.from === 'profile' && !group.pivot.field) issues.push(`${where}: pivot from "profile" needs "field"`);
    } else if (!Object.hasOwn(pack.frameKeys, group.frameKey)) issues.push(`${where}: unknown frameKey "${group.frameKey}"`);
    if (group.publish?.mode === 'none' && !group.publish.reason) issues.push(`${where}: publish "none" must give a reason`);
    if (group.kind !== 'processed-frames') for (const field of ['categories', 'keyPrefix', 'keyMap', 'pivot']) if (field in group) issues.push(`${where}: "${field}" only applies to processed-frames`);
    if (group.kind !== 'processed-frames' && !group.category) issues.push(`${where}: needs "category"`);
    if (group.kind === 'asset-animations')
      for (const field of ['raw', 'processed']) if (!group[field]) issues.push(`${where}: asset-animations needs "${field}"`);
  });
  const processedKeys = Object.keys(pack.directories.processed);
  pack.catalog.sources.forEach((source, i) => {
    if (source.processed && !processedKeys.includes(source.processed)) issues.push(`catalog.sources[${i}]: processed "${source.processed}" is not in directories.processed`);
    if (source.raw && !Object.hasOwn(pack.directories.raw, source.raw)) issues.push(`catalog.sources[${i}]: raw "${source.raw}" is not in directories.raw`);
    if (source.atlas && !Object.hasOwn(pack.frameKeys, source.atlas.frameKey)) issues.push(`catalog.sources[${i}]: unknown atlas frameKey "${source.atlas.frameKey}"`);
  });
  for (const [category, tab] of Object.entries(pack.ui?.categoryTabs ?? {})) if (!category) issues.push(`ui.categoryTabs: empty category for ${tab}`);
  for (const [role, id] of Object.entries(pack.ui?.theme ?? {})) if (!/^[a-z0-9_]+$/.test(id)) issues.push(`ui.theme.${role}: must be a palette colour id`);
  issues.push(...validateGenerators(pack.adapters));
  issues.push(...validateFigures(pack.figures));
  if (pack.rules.outline.mode === 'none' && pack.rules.outline.color !== 'palette') issues.push('rules.outline: color is meaningless when mode is "none"');
  return issues;
}

/** Issues in a pack's `figures` block (an empty list when it is fine). */
function validateFigures(figures = {}) {
  const issues = [];
  const frac = (at, v, lo = 0, hi = 1) => { if (!(typeof v === 'number' && v > lo && v <= hi)) issues.push(`${at}: must be a number above ${lo} and at most ${hi}`); };
  for (const [name, f] of Object.entries(figures)) {
    const at = `figures.${name}`;
    if (!/^[a-z][a-z0-9_]{0,30}$/.test(name)) issues.push(`${at}: name must be lowercase letters, digits and underscores`);
    if (!Array.isArray(f.profiles) || !f.profiles.length || f.profiles.some((p) => typeof p !== 'string' || !p)) issues.push(`${at}.profiles: list the manifest profiles this guide applies to`);
    const h = f.headToBody;
    if (!h || !(h.min > 0 && h.max <= 1 && h.min < h.max) || !(h.target >= h.min && h.target <= h.max)) issues.push(`${at}.headToBody: needs 0 < min < max <= 1 and a target between them`);
    if (!Number.isInteger(f.minLimbWidthPx) || f.minLimbWidthPx < 1 || f.minLimbWidthPx > 16) issues.push(`${at}.minLimbWidthPx: an integer from 1 to 16`);
    if (!Number.isInteger(f.accentMinPixels) || f.accentMinPixels < 1 || f.accentMinPixels > 64) issues.push(`${at}.accentMinPixels: an integer from 1 to 64`);
    if (f.guide !== undefined) for (const k of ['headWidth', 'bodyWidth', 'legWidth', 'legGap']) frac(`${at}.guide.${k}`, f.guide[k]);
    if (f.guide && f.guide.legWidth * 2 + f.guide.legGap > f.guide.bodyWidth + 1e-9) issues.push(`${at}.guide: two legs and their gap are wider than the body`);
  }
  return issues;
}

// Placeholders an argument template may use besides the generator's own parameters.
export const generatorBuiltins = ['out', 'palette', 'seed'];
const registryId = /^[a-z][a-z0-9_]{0,40}$/;

/** Checks of the generator registry and the VFX adapter. A registered generator is the ONLY thing the studio will run. */
function validateGenerators(adapters = {}) {
  const issues = [];
  for (const [id, g] of Object.entries(adapters.generators ?? {})) {
    const at = `adapters.generators.${id}`;
    if (!registryId.test(id)) issues.push(`${at}: id must match ${registryId}`);
    const params = g.params ?? {};
    for (const [name, spec] of Object.entries(params)) {
      if (!registryId.test(name) || generatorBuiltins.includes(name)) issues.push(`${at}.params.${name}: name must match ${registryId} and not be one of ${generatorBuiltins.join(', ')}`);
      if (spec.pattern !== undefined) {
        if (typeof spec.pattern !== 'string' || !isAnchored(spec.pattern)) issues.push(`${at}.params.${name}: pattern must be anchored at both ends (start with ^, end with an unescaped $), so it describes the whole value and not a part of it`);
        else { try { new RegExp(spec.pattern); } catch { issues.push(`${at}.params.${name}: pattern is not a valid regular expression`); } }
      }
      if (spec.type === 'string' && !spec.enum && !spec.pattern) issues.push(`${at}.params.${name}: a string parameter needs an "enum" or a "pattern" (free text is never passed to a program)`);
      if (spec.minimum !== undefined && spec.maximum !== undefined && spec.minimum > spec.maximum) issues.push(`${at}.params.${name}: minimum exceeds maximum`);
      if (spec.default !== undefined && !paramValueOk(spec, spec.default)) issues.push(`${at}.params.${name}: default ${JSON.stringify(spec.default)} does not satisfy its own rules`);
    }
    if (g.seed?.default !== undefined && g.seed.maximum !== undefined && g.seed.default > g.seed.maximum) issues.push(`${at}.seed: default exceeds maximum`);
    const known = new Set([...generatorBuiltins, ...Object.keys(params)]);
    for (const arg of g.args) for (const name of placeholders(arg)) {
      if (!known.has(name)) issues.push(`${at}.args: unknown placeholder {${name}}`);
      if (name === 'seed' && !g.seed) issues.push(`${at}.args: {seed} used but the generator declares no seed`);
    }
    issues.push(...optionInjection(at, g.args, Object.keys(params), params));
    if (!g.args.some(a => placeholders(a).includes('out'))) issues.push(`${at}.args: must pass {out}, the directory the generator writes its frames to`);
  }
  for (const name of Object.keys(adapters.vfx?.palettes ?? {})) if (!/^[a-z0-9_]+$/.test(name)) issues.push(`adapters.vfx.palettes.${name}: name must be lowercase letters, digits and underscores`);
  return issues;
}

const isAnchored = pattern => pattern.startsWith('^') && /(^|[^\\])(\\\\)*\$$/.test(pattern);
const flagToken = /^--?[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * A parameter placeholder may only sit where a script cannot take its value for an option: as its own token right
 * after a flag token (`--shape {shape}`), or embedded as `--flag={name}`. Never first, never glued to other text.
 */
function optionInjection(at, args, paramNames, params) {
  const issues = [];
  args.forEach((arg, i) => {
    const used = placeholders(arg).filter(n => paramNames.includes(n));
    if (!used.length) return;
    const whole = /^\{([A-Za-z_]+)\}$/.exec(arg);
    if (whole) {
      const rule = params?.[whole[1]];
      if ((rule?.type === 'integer' || rule?.type === 'number') && (rule.minimum === undefined || rule.minimum < 0)) issues.push(`${at}.args[${i}]: parameter {${whole[1]}} can be negative (no minimum of 0 or more), and "-5" as a separate token can be read as an option: give it a minimum >= 0, or write --name={${whole[1]}}`);
      if (i === 0 || !flagToken.test(args[i - 1])) issues.push(`${at}.args[${i}]: parameter {${whole[1]}} must come right after its own flag token (for example "--name", "{${whole[1]}}"), or be written --name={${whole[1]}}`);
    } else if (!/^--[A-Za-z][A-Za-z0-9_-]*=\{[A-Za-z_]+\}$/.test(arg)) issues.push(`${at}.args[${i}]: parameter placeholder in "${arg}" must be a whole token after a flag, or exactly --flag={name}`);
  });
  return issues;
}

/** Does `value` satisfy a parameter spec (type, range, enum, pattern)? */
export function paramValueOk(spec, value) {
  if (spec.type === 'integer' && !Number.isInteger(value)) return false;
  if (spec.type === 'number' && !(typeof value === 'number' && Number.isFinite(value))) return false;
  if (spec.type === 'boolean' && typeof value !== 'boolean') return false;
  if (spec.type === 'string' && typeof value !== 'string') return false;
  if (typeof value === 'number' && ((spec.minimum !== undefined && value < spec.minimum) || (spec.maximum !== undefined && value > spec.maximum))) return false;
  if (spec.enum && !spec.enum.includes(value)) return false;
  if (spec.pattern && !new RegExp(`^(?:${spec.pattern})$`).test(String(value))) return false;   // the WHOLE value, whatever the pattern's own anchors
  return true;
}

function check(pack, root, verifyFiles) {
  const issues = validatePack(pack);
  if (!issues.length && verifyFiles) {
    for (const [where, value] of pathFields(pack)) {
      if (where === 'directories.revisions' || where === 'editable.overlay' || where.startsWith('adapters.')
          || where.startsWith('directories.') || where.startsWith('serve.')) continue;
      if (!fs.existsSync(path.join(root, value))) issues.push(`${where}: file not found: ${value}`);
    }
  }
  if (issues.length) throw packError(issues);
  return pack;
}

function parse(text, file) {
  try { return JSON.parse(text); }
  catch (error) { throw packError([`${file}: ${error.message}`]); }
}

/**
 * Load and validate the pack from `root`. `file` is relative to root (default studio.project.json).
 * With `verifyFiles: false` only the pack itself is checked, not that the files it names exist
 * (for callers that read the pack from one place and the project data from another).
 */
export async function loadPack(root, file = packFileName, {verifyFiles = true} = {}) {
  root = await fsp.realpath(root);
  const text = await fsp.readFile(path.join(root, file), 'utf8');
  return check(parse(text, file), root, verifyFiles);
}

export function loadPackSync(root, file = packFileName, {verifyFiles = true} = {}) {
  root = fs.realpathSync(root);
  return check(parse(fs.readFileSync(path.join(root, file), 'utf8'), file), root, verifyFiles);
}

/** Fill {name} placeholders; an unknown placeholder is an error, never silently blank. */
export function fillTemplate(template, values) {
  return template.replace(/\{([A-Za-z_]+)\}/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new Error(`Template "${template}" has no value for {${name}}`);
    return String(values[name]);
  });
}

/** Parse a palette file ({colors:[{hex}], outline}) into 0xRRGGBB ints. */
export function parsePalette(data) {
  const int = hex => parseInt(hex.slice(1), 16);
  const colors = new Set(data.colors.map(c => int(c.hex)));
  return {colors, outline: data.outline === undefined ? undefined : int(data.outline)};
}
