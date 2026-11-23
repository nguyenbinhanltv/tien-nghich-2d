import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { GAME, parseCsv } from './repo.ts';
import { check, validator } from './schemas.ts';

export type Row = Record<string, string | number>;

/** Type a CSV row by its schema: integer/number columns become numbers, empty cells are dropped. */
export function typeRow(schemaName: string, raw: Record<string, string>): Row {
  const props = (validator(schemaName).schema as { properties: Record<string, { type?: string }> }).properties;
  const out: Row = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === '') continue;
    const t = props[k]?.type;
    out[k] = t === 'integer' || t === 'number' ? Number(v) : v;
  }
  return out;
}

export interface Tables { mobs: Row[]; bosses: Row[]; rooms: Row[]; encounters: Record<string, unknown> }

/** Read the sample tables and encounters, schema-check every row. Returns the data and the problems found. */
export function loadTables(root: string = path.join(GAME, 'content')): { tables: Tables; problems: string[] } {
  const problems: string[] = [];
  const read = (name: 'mobs' | 'bosses' | 'rooms'): Row[] => {
    const file = path.join(root, 'tables', `${name}.csv`);
    const rows = parseCsv(fs.readFileSync(file, 'utf8')).map((r) => typeRow(`table-${name}.schema.json`, r));
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      problems.push(...check(`table-${name}.schema.json`, row, `${name}.csv row ${i + 2}`));
      const id = String(row.id);
      if (seen.has(id)) problems.push(`${name}.csv row ${i + 2}: duplicate id ${id}`);
      seen.add(id);
    });
    return rows;
  };
  const encDir = path.join(root, 'encounters');
  const encounters: Record<string, unknown> = {};
  for (const f of fs.readdirSync(encDir).filter((n) => n.endsWith('.yaml')).sort()) {
    const data = YAML.parse(fs.readFileSync(path.join(encDir, f), 'utf8')) as unknown;
    problems.push(...check('encounter.schema.json', data, `encounters/${f}`));
    const id = f.replace(/\.yaml$/, '');
    if ((data as { id?: string }).id !== id) problems.push(`encounters/${f}: id must equal the file name`);
    encounters[id] = data;
  }
  return { tables: { mobs: read('mobs'), bosses: read('bosses'), rooms: read('rooms'), encounters }, problems };
}

interface Encounter { id: string; boss: string; attacks: Record<string, { clip: string; hit: { id: string } }>; phases: { loop: string[]; enter_clip?: string }[] }

/** Cross-references the schemas cannot express: ids exist in the art manifests, clips exist, rooms chain, every name has a locale string. */
export function crossCheck(t: Tables, assets: Map<string, { category: string; clips: Record<string, number> }>, locale: Record<'vi' | 'en', Record<string, string>>): string[] {
  const p: string[] = [];
  const need = (id: string, category: string, at: string): { clips: Record<string, number> } | undefined => {
    const a = assets.get(id);
    if (!a) p.push(`${at}: ${id} is not in assets/manifest*.json`);
    else if (a.category !== category) p.push(`${at}: ${id} is a ${a.category}, expected ${category}`);
    return a;
  };
  for (const m of t.mobs) {
    const a = need(String(m.id), 'mob', `mobs.csv ${m.id}`);
    if (a && !(String(m.attack_clip) in a.clips)) p.push(`mobs.csv ${m.id}: no clip ${m.attack_clip}`);
  }
  const roomIds = new Set(t.rooms.map((r) => String(r.id)));
  const mobIds = new Set(t.mobs.map((m) => String(m.id)));
  const bossIds = new Set(t.bosses.map((b) => String(b.id)));
  for (const b of t.bosses) {
    need(String(b.id), 'boss', `bosses.csv ${b.id}`);
    const e = t.encounters[String(b.encounter)] as Encounter | undefined;
    if (!e) { p.push(`bosses.csv ${b.id}: no content/encounters/${b.encounter}.yaml`); continue; }
    if (e.boss !== b.id) p.push(`encounters/${e.id}.yaml: boss ${e.boss} differs from bosses.csv ${b.id}`);
    const clips = assets.get(e.boss)?.clips ?? {};
    for (const [name, atk] of Object.entries(e.attacks)) if (!(atk.clip in clips)) p.push(`encounters/${e.id}.yaml attack ${name}: boss has no clip ${atk.clip}`);
    for (const ph of e.phases) {
      if (ph.enter_clip && !(ph.enter_clip in clips)) p.push(`encounters/${e.id}.yaml: no clip ${ph.enter_clip}`);
      for (const a of ph.loop) if (!(a in e.attacks)) p.push(`encounters/${e.id}.yaml: phase loops unknown attack ${a}`);
    }
  }
  for (const r of t.rooms) {
    const at = `rooms.csv ${r.id}`;
    need(String(r.tileset), 'tileset', at);
    for (const part of String(r.mobs ?? '').split(';').filter(Boolean)) if (!mobIds.has(part.split(':')[0]!)) p.push(`${at}: unknown mob ${part.split(':')[0]}`);
    if (r.boss && !bossIds.has(String(r.boss))) p.push(`${at}: unknown boss ${r.boss}`);
    if (r.next && !roomIds.has(String(r.next))) p.push(`${at}: next ${r.next} is not a room`);
  }
  for (const id of [...mobIds, ...bossIds]) for (const l of ['vi', 'en'] as const) if (!locale[l][id]) p.push(`locale/${l}.json: missing display name for ${id}`);
  return p;
}

interface BodyLike { clips?: Record<string, { frames: Record<string, { hitboxes?: { id: string }[] }> }> }
interface MobRow { id: string; biome: string }

/**
 * Semantic checks the schemas and crossCheck cannot express (E3.1). Errors fail the build; warnings are shown.
 * `bodies` (compiled bodies.json) is optional: when given, an encounter hit id with no matching hitbox on the boss is a warning
 * (the boxes are drafts today, so it cannot be an error yet; `strict` turns it into one for the release gate).
 */
export function semanticCheck(t: Tables, bodies: Record<string, unknown> = {}, strict = false): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  // 1. ids are unique across the three tables (a mob and a boss must not share an id)
  const seen = new Map<string, string>();
  for (const [kind, rows] of [['mobs', t.mobs], ['bosses', t.bosses], ['rooms', t.rooms]] as const)
    for (const r of rows) { const id = String(r.id); const prev = seen.get(id); if (prev && prev !== kind) errors.push(`${kind}.csv ${id}: id is already used in ${prev}.csv`); seen.set(id, kind); }

  // 2. encounters
  for (const [eid, raw] of Object.entries(t.encounters)) {
    const e = raw as { boss: string; phases: { id: string; hp_above: number; loop: string[] }[]; attacks: Record<string, { tell: { ms: number }; dodge_window_ms: number; hit: { id: string } }> };
    const at = `encounters/${eid}.yaml`;
    if (!Array.isArray(e.phases) || !e.attacks) continue; // schema already reported it
    const ids = e.phases.map((p) => p.id);
    ids.forEach((id, i) => { if (ids.indexOf(id) !== i) errors.push(`${at}: duplicate phase id ${id}`); });
    for (let i = 1; i < e.phases.length; i++)
      if (e.phases[i]!.hp_above >= e.phases[i - 1]!.hp_above) errors.push(`${at}: phase ${e.phases[i]!.id} has hp_above ${e.phases[i]!.hp_above}, it must be lower than the previous phase (${e.phases[i - 1]!.hp_above})`);
    if (e.phases.at(-1)!.hp_above !== 0) errors.push(`${at}: the last phase must have hp_above 0 or the boss has no phase below ${e.phases.at(-1)!.hp_above} of its health`);
    const used = new Set(e.phases.flatMap((p) => p.loop));
    for (const a of Object.keys(e.attacks)) if (!used.has(a)) warnings.push(`${at}: attack ${a} is never used by any phase`);
    const hitIds = new Map<string, string>();
    for (const [name, a] of Object.entries(e.attacks)) {
      if (a.dodge_window_ms > a.tell.ms) errors.push(`${at} attack ${name}: dodge_window_ms ${a.dodge_window_ms} is longer than the tell (${a.tell.ms} ms); the dodge could not be finished before the hit`);
      const dup = hitIds.get(a.hit.id);
      if (dup) errors.push(`${at}: attacks ${dup} and ${name} share hit id ${a.hit.id}`);
      hitIds.set(a.hit.id, name);
    }
    const body = bodies[e.boss] as BodyLike | undefined;
    const boxes = new Set(Object.values(body?.clips ?? {}).flatMap((c) => Object.values(c.frames).flatMap((f) => (f.hitboxes ?? []).map((h) => h.id))));
    if (body) for (const [name, a] of Object.entries(e.attacks)) if (!boxes.has(a.hit.id)) (strict ? errors : warnings).push(`${at} attack ${name}: no hitbox named ${a.hit.id} on ${e.boss} (its hitboxes: ${[...boxes].join(', ') || 'none'})`);
  }

  // 3. mobs fight in their own biome, and room contents match the room kind
  const mobs = new Map(t.mobs.map((m) => [String(m.id), m as unknown as MobRow]));
  const rooms = new Map(t.rooms.map((r) => [String(r.id), r]));
  for (const r of t.rooms) {
    const at = `rooms.csv ${r.id}`, kind = String(r.kind), hasMobs = Boolean(r.mobs), hasBoss = Boolean(r.boss);
    if (kind === 'combat' && !hasMobs) errors.push(`${at}: a combat room needs mobs`);
    if (kind !== 'combat' && hasMobs) errors.push(`${at}: only a combat room has mobs (this one is ${kind})`);
    if (kind === 'boss' && !hasBoss) errors.push(`${at}: a boss room needs a boss`);
    if (kind !== 'boss' && hasBoss) errors.push(`${at}: only a boss room has a boss (this one is ${kind})`);
    for (const part of String(r.mobs ?? '').split(';').filter(Boolean)) {
      const [mid, count] = part.split(':');
      const m = mobs.get(mid!);
      if (m && m.biome !== r.biome) errors.push(`${at}: ${mid} is a ${m.biome} mob in a ${r.biome} room`);
      if (!/^[1-9][0-9]*$/.test(count ?? '')) errors.push(`${at}: mob entry "${part}" needs a positive count (mob_id:count)`);
    }
  }

  // 4. the room chains: one abode start; each biome is one chain (its head is the room nothing points to, or the one the abode points to),
  //    every room reachable, no loop, a chain stays in one biome, ends on a reward room with the boss room right before it
  const starts = t.rooms.filter((r) => r.kind === 'abode');
  if (t.rooms.length && starts.length !== 1) errors.push(`rooms.csv: expected exactly one abode room to start from, found ${starts.length}`);
  if (starts.length === 1) {
    const pointed = new Set(t.rooms.map((r) => (r.next ? String(r.next) : '')).filter(Boolean));
    const heads = [String(starts[0]!.next ?? ''), ...t.rooms.filter((r) => r.kind !== 'abode' && !pointed.has(String(r.id))).map((r) => String(r.id))].filter((h, i, all) => h && all.indexOf(h) === i && rooms.has(h));
    const reached = new Set<string>([String(starts[0]!.id)]);
    const biomes = new Map<string, string>();
    for (const head of heads) {
      const order: string[] = [];
      let cur: string | undefined = head;
      while (cur && rooms.has(cur)) {
        if (order.includes(cur)) { errors.push(`rooms.csv: the room chain loops back to ${cur} (${[...order, cur].join(' -> ')})`); break; }
        order.push(cur); reached.add(cur);
        const next: string | number | undefined = rooms.get(cur)!.next;
        cur = next ? String(next) : undefined;
      }
      const biome = String(rooms.get(head)!.biome), other = biomes.get(biome);
      if (other) errors.push(`rooms.csv: biome ${biome} has two room chains (from ${other} and ${head})`);
      biomes.set(biome, head);
      for (const id of order) if (rooms.get(id)!.biome !== biome) errors.push(`rooms.csv ${id}: a ${rooms.get(id)!.biome} room inside the ${biome} chain from ${head}`);
      const last = rooms.get(order.at(-1)!);
      if (last && last.kind !== 'reward') errors.push(`rooms.csv ${last.id}: the chain ends here but it is a ${last.kind} room, not a reward room`);
      const bossAt = order.findIndex((id) => rooms.get(id)!.kind === 'boss');
      if (bossAt >= 0 && bossAt !== order.length - 2) errors.push(`rooms.csv: the boss room must come right before the reward room (chain: ${order.join(' -> ')})`);
      if (bossAt < 0) errors.push(`rooms.csv: the chain from ${head} has no boss room`);
    }
    for (const id of rooms.keys()) if (!reached.has(id)) errors.push(`rooms.csv ${id}: not reachable from the abode (chains: ${heads.join(', ')})`);
  }
  return { errors, warnings };
}
