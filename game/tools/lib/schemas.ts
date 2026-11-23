import fs from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import { GAME } from './repo.ts';

const dir = path.join(GAME, 'schemas');
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true, strictRequired: false });
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.schema.json')).sort())
  ajv.addSchema(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as object, f);

export function validator(name: string): ValidateFunction {
  const v = ajv.getSchema(name);
  if (!v) throw new Error(`unknown schema ${name}`);
  return v;
}

/** Validate or return readable problems ("<where>: <message>"). */
export function check(name: string, data: unknown, where: string): string[] {
  const v = validator(name);
  if (v(data)) return [];
  return (v.errors ?? []).map((e) => `${where}${e.instancePath || ''}: ${e.message ?? 'invalid'}${e.params && 'additionalProperty' in e.params ? ` (${String(e.params.additionalProperty)})` : ''}`);
}
