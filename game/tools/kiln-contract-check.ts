// Reads what Kiln holds for the game contract and reports it. Exit 1 on invalid data.
//   --strict   also fail on what a release needs: no unreviewed or missing bodies for the slice assets, and tell/hit events on attack clips.
//              Never run in CI for the default branch: today the repository holds none, so --strict is expected to fail until M0.
import { loadAssets } from './lib/assets.ts';
import { loadTables, semanticCheck } from './lib/tables.ts';
import { verifyLocks } from './lib/hitbox-edit.ts';
import { compileAudioEvents, compileBodies, compileClipEvents, compileTileShapes, lintClips, readSidecars, verifyApprovals } from './lib/kiln-contract.ts';

const strict = process.argv.includes('--strict');
const assets = loadAssets('mobile');
const sidecars = readSidecars();
const bodies = compileBodies(assets, sidecars);
const events = compileClipEvents(assets, sidecars);
const shapes = compileTileShapes(assets, sidecars);
const audio = compileAudioEvents(assets);
const approvals = verifyApprovals(bodies.data.bodies);
const { tables, problems: tableProblems } = loadTables();

const attackClips = [
  ...tables.mobs.map((m) => ({ asset: String(m.id), clip: String(m.attack_clip) })),
  ...Object.values(tables.encounters).flatMap((e) => Object.values((e as { boss: string; attacks: Record<string, { clip: string }> }).attacks).map((a) => ({ asset: (e as { boss: string }).boss, clip: a.clip }))),
];
const semantic = semanticCheck(tables, bodies.data.bodies, strict);
const lint = lintClips(events.data, attackClips);

const sliceIds = [...new Set(attackClips.map((a) => a.asset))];
const missingBodies = sliceIds.filter((id) => !bodies.data.bodies[id]);
const errors = [...bodies.problems, ...events.problems, ...shapes.problems, ...audio.problems, ...approvals.problems, ...semantic.errors, ...verifyLocks(), ...tableProblems, ...lint.errors];
const warnings = [...semantic.warnings, ...bodies.warnings, ...events.warnings, ...shapes.warnings, ...audio.warnings, ...lint.warnings];
if (strict) {
  for (const id of missingBodies) errors.push(`strict: no bodies for slice asset ${id}`);
  for (const id of approvals.unreviewed) errors.push(`strict: bodies for ${id} are not owner-approved`);
  errors.push(...lint.warnings.map((w) => `strict: ${w}`));
}

const n = (o: object): number => Object.keys(o).length;
console.log('Kiln <-> game contract');
console.log(`  bodies        ${n(bodies.data.bodies)} assets (${approvals.approved} owner-approved, ${approvals.unreviewed.length} unreviewed); slice assets without bodies: ${missingBodies.length}/${sliceIds.length}`);
console.log(`  clip events   ${n(events.data.clips)} assets`);
console.log(`  tile shapes   ${n(shapes.data.tilesets)} tilesets`);
console.log(`  audio events  ${n(audio.data.events)} assets, ${n(audio.data.modes)} modes, ${audio.data.silent.length} silent`);
console.log(`  sidecars      ${sidecars.size} studio-metadata.json file(s) read`);
for (const w of warnings) console.log(`  warning: ${w}`);
for (const e of errors) console.error(`  ERROR: ${e}`);
console.log(errors.length ? `FAILED: ${errors.length} problem(s)` : 'OK');
process.exit(errors.length ? 1 : 0);
