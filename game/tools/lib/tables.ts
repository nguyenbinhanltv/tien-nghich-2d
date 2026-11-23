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
export function loadTables(): { tables: Tables; problems: string[] } {
  const problems: string[] = [];
  const read = (name: 'mobs' | 'bosses' | 'rooms'): Row[] => {
    const file = path.join(GAME, 'content/tables', `${name}.csv`);
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
  const encDir = path.join(GAME, 'content/encounters');
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
