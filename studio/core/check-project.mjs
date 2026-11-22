// `studio check`: is this project's pack complete, and what is missing? Reads only; writes nothing.
// Errors stop the studio from working with the project; warnings say what will not work yet; notes are information.
import fs from 'node:fs';
import path from 'node:path';
import { interpreterAvailable } from './adapters.mjs';
import { loadPack, packFileName, parsePalette } from './pack.mjs';

const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const exists = (root, rel) => fs.existsSync(path.join(root, rel));
const AGENT_CONFIGS = ['.mcp.json', '.codex/config.toml', '.agents/mcp_config.json'];

/** Returns {ok, id, name, errors, warnings, notes, counts}. Every entry is {where, message}. */
export async function checkProject(rootArg) {
  const root = path.resolve(rootArg);
  const out = {ok: false, root, id: null, name: null, errors: [], warnings: [], notes: [], counts: {}};
  const error = (where, message) => out.errors.push({where, message});
  const warn = (where, message) => out.warnings.push({where, message});
  const note = (where, message) => out.notes.push({where, message});
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) { error(root, 'not a directory'); return out; }
  if (!exists(root, packFileName)) { error(packFileName, `not found in ${root}. Create a project with: node <studio>/cli.mjs init <dir>`); return out; }

  let pack;
  try { pack = await loadPack(root); }
  catch (e) {
    if (e.code === 'invalid_pack') { for (const issue of e.issues) error(packFileName, issue); }
    else error(packFileName, e.message);
    return out;
  }
  out.id = pack.id; out.name = pack.name;

  // The palette: colours, one outline colour, and the colours the pack names.
  try {
    const file = readJson(root, pack.palette.file);
    parsePalette(file);
    const ids = new Set((file.colors ?? []).map(c => c.id));
    out.counts.colours = file.colors?.length ?? 0;
    if (!file.outline) warn(pack.palette.file, 'no "outline" colour: outline checks need one');
    for (const [role, id] of Object.entries(pack.ui?.theme ?? {})) if (!ids.has(id)) warn(`ui.theme.${role}`, `names colour "${id}", which is not in the palette`);
    if (pack.rules.outline.color !== 'palette' && !(file.colors ?? []).some(c => c.hex.toLowerCase() === pack.rules.outline.color.toLowerCase()))
      warn('rules.outline.color', `${pack.rules.outline.color} is not a colour of the palette, so a sprite cannot use it`);
  } catch (e) { error(pack.palette.file, `cannot read the palette: ${e.message}`); }

  // Tabs that need their own block of the pack.
  if (!pack.ui?.tabs?.characters) warn('ui.tabs.characters', 'absent: the Characters tab answers "not configured" (it needs categories, facings, defaultFrameMs and rawRoots)');

  // The directories: missing ones are created on first use, so this is a note.
  for (const [group, entries] of Object.entries(pack.directories)) {
    if (typeof entries === 'string') continue;
    for (const [name, dir] of Object.entries(entries)) if (!exists(root, dir)) note(`directories.${group}.${name}`, `${dir} does not exist yet; it is created on first use`);
  }

  // The catalog sources.
  const sizeOk = size => Object.values(pack.sizeClasses).some(c => (c.sizes ?? []).some(s => s[0] === size[0] && s[1] === size[1])
    || (c.min && size[0] >= c.min[0] && size[1] >= c.min[1] && size[0] <= c.max[0] && size[1] <= c.max[1] && (!c.square || size[0] === size[1])));
  for (const source of pack.catalog.sources) {
    const where = `catalog.sources.${source.id}`;
    let data;
    try { data = readJson(root, source.file); } catch (e) { error(source.file, `cannot read: ${e.message}`); continue; }
    if (source.kind === 'design-manifest') {
      const profiles = data.profiles ?? {}, assets = data.assets ?? [], seen = new Set();
      out.counts[`${source.id}.profiles`] = Object.keys(profiles).length; out.counts[`${source.id}.assets`] = assets.length;
      for (const [name, p] of Object.entries(profiles)) {
        if (!Array.isArray(p.native_px)) error(`${source.file}`, `profile ${name} has no native_px`);
        else if (!sizeOk(p.native_px)) warn(`${source.file}`, `profile ${name} is ${p.native_px.join('x')}, which fits no size class of the pack`);
        if (p.category && !pack.catalog.categories?.[p.category]) note(`${source.file}`, `profile ${name}: category "${p.category}" has no entry in catalog.categories (no outline rule, no tab)`);
        if (p.category && !pack.ui?.categoryTabs?.[p.category]) warn(`${source.file}`, `profile ${name}: category "${p.category}" is in no tab (ui.categoryTabs)`);
      }
      for (const a of assets) {
        if (seen.has(a.id)) error(source.file, `asset ${a.id} appears twice`); seen.add(a.id);
        if (!profiles[a.profile]) error(source.file, `asset ${a.id} names profile "${a.profile}", which does not exist`);
        if (source.idPattern && !new RegExp(source.idPattern).test(a.id)) warn(source.file, `asset ${a.id} does not match the source's idPattern`);
      }
      if (!assets.length) note(where, 'no assets are planned yet (an agent or you can add one with studio_asset_plan)');
    } else if (source.kind === 'audio-plan') {
      let cues = 0;
      const walk = node => { if (Array.isArray(node)) cues += node.filter(x => typeof x === 'string').length; else if (node && typeof node === 'object') Object.values(node).forEach(walk); };
      walk(data.core); walk(data.extensions);
      out.counts[`${source.id}.cues`] = cues;
      if (source.evidence?.packs) {
        const rates = new Set();
        const packsDir = path.join(root, source.evidence.packs);
        for (const e of fs.existsSync(packsDir) ? fs.readdirSync(packsDir, {withFileTypes: true}) : []) {
          if (!e.isDirectory()) continue;
          try { const rate = JSON.parse(fs.readFileSync(path.join(packsDir, e.name, 'pack.json'), 'utf8')).sample_rate_hz; if (rate) rates.add(rate); } catch { /* not a pack */ }
        }
        if (!rates.size) note(where, 'no audio pack states a sample_rate_hz, so a rendered cue keeps the rate of its own document');
        if (rates.size > 1) error(where, `audio packs disagree on the sample rate: ${[...rates].join(', ')}`);
      }
    }
  }

  // Programs: only a registered one can run; say which cannot on this machine.
  if (!interpreterAvailable(root, pack.adapters.interpreter)) warn('adapters.interpreter', `${pack.adapters.interpreter.command} does not exist on this machine, so registered scripts and commands cannot run`);
  for (const [id, g] of Object.entries(pack.adapters.generators ?? {})) if (!exists(root, g.script)) error(`adapters.generators.${id}`, `script ${g.script} does not exist`);
  for (const [id, c] of Object.entries(pack.adapters.commands ?? {})) if (!exists(root, c.script)) warn(`adapters.commands.${id}`, `script ${c.script} does not exist`);
  if (pack.adapters.vfx) {
    if (!exists(root, pack.adapters.vfx.clone)) warn('adapters.vfx', `the SpriteFX clone ${pack.adapters.vfx.clone} is not here: VFX builds are unavailable`);
  }
  out.counts.generators = Object.keys(pack.adapters.generators ?? {}).length;

  // Review: without a baseline declaration every frame awaits review (which is the right start).
  note('review', pack.review?.baseline ? `baseline declared in ${pack.review.baseline.file}` : 'no baseline declared: every frame without a human record is awaiting review');

  for (const rel of AGENT_CONFIGS) if (!exists(root, rel)) note(rel, 'not present: that agent has no MCP connection to this project (studio init writes all three)');
  out.ok = out.errors.length === 0;
  return out;
}

/** Plain-text report, one line per finding. */
export function formatCheck(result) {
  const lines = [`${result.name ?? '(no pack)'}${result.id ? ` [${result.id}]` : ''}: ${result.ok ? 'OK' : 'NOT OK'} (${result.errors.length} errors, ${result.warnings.length} warnings)`];
  for (const [label, list] of [['error', result.errors], ['warning', result.warnings], ['note', result.notes]])
    for (const f of list) lines.push(`  ${label.padEnd(7)} ${f.where}: ${f.message}`);
  const counts = Object.entries(result.counts).map(([k, v]) => `${k} ${v}`).join(', ');
  if (counts) lines.push(`  counts  ${counts}`);
  return lines.join('\n');
}
