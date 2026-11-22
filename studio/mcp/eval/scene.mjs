// The evaluation scene: a throwaway project put into a known state by a harness (not by the agent
// under test), plus ground truth computed WITHOUT the studio tools, by reading files and databases
// directly. The agent answers read-only questions about the scene through the real server.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { bareFrame } from '../../core/review.mjs';
import { decodeRgba } from '../../core/png.mjs';
import { JobRunner } from '../../core/jobs.mjs';
import { PROVENANCE, clipFrames, connect, makeFrame, makeProject } from '../testkit.mjs';
import { openProject } from '../project.mjs';

const ASSET = 'lt_seed_broker';
const RAW = `assets/raw/longtime/${ASSET}/frames`;
const key = (n) => `longtime/${ASSET}/idle_south_${n}`;

/** Build the scene. Returns {root, cleanup, truth}. */
export async function buildScene() {
  const p = makeProject({ git: true });
  const project = openProject(p.root);
  const jobs = new JobRunner();
  const author = connect(project, { scope: 'author', agent: 'codex', jobs });
  const checker = connect(project, { scope: 'author', agent: 'claude-code', jobs });

  // 1. One session submits four frames; a different session checks them while they are clean and passes them.
  await author.ok('studio_frames_submit', { assetId: ASSET, provenance: PROVENANCE, frames: clipFrames('idle', 'south', 4) });
  await checker.ok('studio_qa_run', { assetId: ASSET, independent: true });
  // 2. The author asks a human to review.
  await author.ok('studio_review_request', { assetId: ASSET, note: 'Seed broker, idle, facing south. First pass.' });

  // 3. A human works in the review store, exactly as the review UI does.
  const store = await project.workspace.store();
  const png = (n) => makeFrame(32, 32, { variant: n }).png;
  store.operate(bareFrame(key(0)), png(0), 'review', { revision: 0, status: 'approved' });
  store.operate(bareFrame(key(1)), png(1), 'review', { revision: 0, text: 'The carrying pole reads too long next to the body.' });
  store.operate(bareFrame(key(2)), png(2), 'review', { revision: 0, status: 'changes_requested', text: 'The hat is unreadable at this size.' });
  const edited = makeFrame(32, 32, { variant: 40 }).png;
  store.operate(bareFrame(key(3)), png(3), 'save', { baseRevision: 0, png: edited });

  // 4. Afterwards frame 2 is damaged on disk (the way a careless merge or script could): one off-palette pixel.
  writeFileSync(join(p.root, RAW, 'idle_south_2.png'), makeFrame(32, 32, { variant: 2, damage: [{ x: 14, y: 15, kind: 'color' }] }).png);

  project.close();
  return { root: p.root, cleanup: p.cleanup, truth: groundTruth(p.root) };
}

// ---- ground truth, independent of the studio tools -------------------------------------------
const readJson = (root, rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

export function groundTruth(root) {
  const manifest = readJson(root, 'assets/manifest_longtime.json');
  // "Planned" in this scene: no processed PNG exists (only lt_kiln_keeper has any).
  const hasProcessed = (id) => { try { return readdirSync(join(root, `assets/processed_longtime/${id}`)).some((f) => f.endsWith('.png')); } catch { return false; } };
  const planned = manifest.assets.filter((a) => !hasProcessed(a.id));

  // Q1: frames needed by the planned boss in the ember_delta chunk.
  const boss = planned.filter((a) => manifest.profiles[a.profile].category === 'boss' && a.chunk_group === 'ember_delta');
  const profile = manifest.profiles[boss[0].profile];
  const frames = Object.values(profile.clips).reduce((n, [count]) => n + count, 0) * profile.directions.length;

  // Q2: planned assets in chunks that have at least one planned boss.
  const bossChunks = new Set(planned.filter((a) => manifest.profiles[a.profile].category === 'boss').map((a) => a.chunk_group));
  const inBossChunks = planned.filter((a) => bossChunks.has(a.chunk_group)).length;

  // Q3: the off-palette pixel, found by scanning the PNGs against the palette file.
  const palette = readJson(root, 'tools/generators/palette.json');
  const allowed = new Set(palette.colors.map((c) => parseInt(c.hex.slice(1), 16)));
  let off = null;
  for (let n = 0; n < 4 && !off; n++) {
    const img = decodeRgba(readFileSync(join(root, RAW, `idle_south_${n}.png`)));
    for (let y = 0; y < img.height && !off; y++) for (let x = 0; x < img.width && !off; x++) {
      const k = (y * img.width + x) * 4;
      if (img.pixels[k + 3] === 255 && !allowed.has(img.pixels.readUIntBE(k, 3))) off = { frame: `idle_south_${n}`, x, y, hex: '#' + img.pixels.readUIntBE(k, 3).toString(16).padStart(6, '0') };
    }
  }

  // Q4: the frame whose human comment mentions the pole, and its review status, read from the store's database.
  const rev = new DatabaseSync(join(root, '.inspector-revisions/editor.sqlite'), { readOnly: true });
  const poleRow = rev.prepare("SELECT key, rev, text FROM reviews WHERE text LIKE '%pole%' AND text NOT LIKE '[agent %'").all();
  const statusOf = (k, r) => rev.prepare(`SELECT coalesce((select status from reviews where key=? and rev=? and status is not null order by seq desc limit 1), case ? when 0 then 'approved' else 'pending' end) AS s`).get(k, r, r).s;
  const pole = { frame: poleRow[0].key.split('/').pop(), status: statusOf(poleRow[0].key, poleRow[0].rev), rows: poleRow.length };
  rev.close();

  // Q5: who recorded the independent check, and does it still describe the frames as they are now?
  const db = new DatabaseSync(join(root, '.inspector-revisions/studio.sqlite'), { readOnly: true });
  const check = db.prepare('SELECT agent, content FROM checks WHERE asset=? AND independent=1 AND pass=1 ORDER BY seq DESC').get(ASSET);
  db.close();
  const parts = [0, 1, 2, 3].map((n) => `${RAW}/idle_south_${n}.png:${createHash('sha256').update(readFileSync(join(root, RAW, `idle_south_${n}.png`))).digest('hex')}`);
  const current = createHash('sha256').update(parts.join('\n')).digest('hex');

  return {
    q1: String(frames), q1Asset: boss[0].id,
    q2: String(inBossChunks),
    q3: `${off.frame} ${off.hex}`, q3Pixel: off,
    q4: `${pole.frame} ${pole.status}`, q4Rows: pole.rows,
    q5: `${check.agent} ${check.content === current ? 'yes' : 'no'}`,
  };
}

