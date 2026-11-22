// The sample rate is a property of the project, not of a patch: it comes from the project's packed audio
// (the audio-plan source's packs directory, each pack.json's sample_rate_hz). Nothing here names a project.
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPack } from '../core/pack.mjs';

function collect(node, out) {
  if (Array.isArray(node)) node.forEach(n => collect(n, out));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) {
    if (k === 'sample_rate_hz' && Number.isInteger(v)) out.add(v); else collect(v, out);
  }
}

/** {sampleRate, packs: [dir names]} from the project's audio packs; sampleRate null when the project has none. */
export async function projectAudio(root) {
  const pack = await loadPack(root, undefined, {verifyFiles: false});
  const source = pack.catalog.sources.find(s => s.kind === 'audio-plan');
  const packsDir = source?.evidence?.packs;
  const rates = new Set(), packs = [];
  if (packsDir) {
    let entries = [];
    try { entries = await fs.readdir(path.join(root, packsDir), {withFileTypes: true}); } catch { /* no packs yet */ }
    for (const e of entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      try { collect(JSON.parse(await fs.readFile(path.join(root, packsDir, e.name, 'pack.json'), 'utf8')), rates); packs.push(e.name); } catch { /* not a pack */ }
    }
  }
  if (rates.size > 1) throw Object.assign(new Error(`Project audio packs disagree on the sample rate: ${[...rates].join(', ')}`), {code: 'mixed_sample_rates'});
  const protectedDirs = [source?.evidence?.packs, source?.evidence?.masters, source?.evidence?.sources].filter(Boolean);
  return {sampleRate: rates.size ? [...rates][0] : null, packs, protectedDirs};
}

/** Give a document its project sample rate when it has none; throw when it names a different one. */
export function applyProjectRate(doc, sampleRate) {
  if (sampleRate === null || sampleRate === undefined) return doc;
  if (doc.sampleRate === undefined) return {...doc, sampleRate};
  if (doc.sampleRate !== sampleRate)
    throw Object.assign(new Error(`Document sampleRate ${doc.sampleRate} differs from the project's ${sampleRate} Hz`), {code: 'sample_rate_mismatch'});
  return doc;
}

/** True when `target` is inside one of the project's delivered-audio directories (renders must never go there). */
export function insideProtected(root, protectedDirs, target) {
  const abs = path.resolve(target);
  return protectedDirs.some(dir => {
    const rel = path.relative(path.resolve(root, dir), abs);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}
