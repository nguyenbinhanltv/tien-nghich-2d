import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const repo = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
export const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(repo, ...parts), 'utf8'));
export const exampleDir = path.join(repo, 'studio/audio/examples');
export const experiments = path.join(repo, 'assets/experiments/audio_engine');

/** A sine as a decoded-audio object (full-scale units). */
export function sine({hz = 997, amp = 0.1, seconds = 5, rate = 48000, channels = 1}) {
  const n = Math.round(seconds * rate), x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin(2 * Math.PI * hz * i / rate);
  return {sampleRate: rate, samples: Array.from({length: channels}, () => x)};
}
