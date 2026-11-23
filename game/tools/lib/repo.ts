// Locations and small readers shared by the build and check tools. Everything is relative to the repository root
// (game/tools/lib -> ../../..), so the tools run the same from game/ or from the repo root.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const GAME = path.join(REPO, 'game');
export const ASSETS = path.join(REPO, 'assets');

export const readJson = <T = unknown>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;
export const sha256 = (data: Uint8Array | string): string => crypto.createHash('sha256').update(data).digest('hex');
export const rel = (file: string): string => path.relative(REPO, file).split(path.sep).join('/');

/** RFC 4180-ish CSV with a header row: quotes and doubled quotes, comma delimiter, LF or CRLF. Empty cells stay ''. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v !== '')) rows.push(row);
  const header = rows.shift();
  if (!header) return [];
  return rows.map((r, n) => {
    if (r.length !== header.length) throw new Error(`CSV row ${n + 2} has ${r.length} cells, header has ${header.length}`);
    return Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()]));
  });
}

/** Studio's PNG decoder is plain JS; load it by URL so the game build needs no copy of it. */
export interface Rgba { width: number; height: number; pixels: Uint8Array }
export async function loadDecoder(): Promise<(png: Buffer) => Rgba> {
  const mod = (await import(pathToFileURL(path.join(REPO, 'studio/core/png.mjs')).href)) as { decodeRgba: (png: Buffer) => Rgba };
  return mod.decodeRgba;
}
