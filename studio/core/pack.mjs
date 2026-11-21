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
  fields.push(['directories.revisions', pack.directories?.revisions]);
  (pack.catalog?.sources ?? []).forEach((s, i) => fields.push([`catalog.sources[${i}].file`, s.file]));
  fields.push(['adapters.interpreter.command', pack.adapters?.interpreter?.command]);
  for (const [name, command] of Object.entries(pack.adapters?.commands ?? {})) fields.push([`adapters.commands.${name}.script`, command.script]);
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
    const wanted = {'asset-animations': 'asset-manifest', 'vfx-descriptor': 'vfx-index'}[group.kind];
    if (!source) issues.push(`${where}: unknown catalog source "${group.source}"`);
    else if (source.kind !== wanted) issues.push(`${where}: kind "${group.kind}" needs a ${wanted} source`);
    if (!Object.hasOwn(pack.frameKeys, group.frameKey)) issues.push(`${where}: unknown frameKey "${group.frameKey}"`);
    if (!group.category) issues.push(`${where}: needs "category"`);
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
  if (pack.rules.outline.mode === 'none' && pack.rules.outline.color !== 'palette') issues.push('rules.outline: color is meaningless when mode is "none"');
  return issues;
}

function check(pack, root, verifyFiles) {
  const issues = validatePack(pack);
  if (!issues.length && verifyFiles) {
    for (const [where, value] of pathFields(pack)) {
      if (where === 'directories.revisions' || where === 'editable.overlay' || where.startsWith('adapters.')
          || where.startsWith('directories.')) continue;
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
