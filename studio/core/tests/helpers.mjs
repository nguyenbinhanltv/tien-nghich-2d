import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const realPack = () => JSON.parse(fs.readFileSync(root + 'studio.project.json', 'utf8'));
export const clone = value => structuredClone(value);
