// E9.1 CLI. node tools/qa-replay.ts            compare a fresh run of every scenario to tests/golden/replay.json (exit 1 on any difference)
//           node tools/qa-replay.ts --record   rewrite the golden after an intended sim change; review the diff before committing.
import fs from 'node:fs';
import path from 'node:path';
import { compareToGolden, GOLDEN_FILE, recordAll, replayHash, runScenario, SCENARIOS } from './lib/qa-replay.ts';
import type { Golden } from './lib/qa-replay.ts';

if (process.argv.includes('--record')) {
  fs.mkdirSync(path.dirname(GOLDEN_FILE), { recursive: true });
  const g = recordAll();
  fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(g, null, 1)}\n`);
  console.log(`recorded ${Object.keys(g.scenarios).length} scenarios to ${path.relative(process.cwd(), GOLDEN_FILE)}`);
} else {
  const problems = compareToGolden(JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')) as Golden);
  for (const s of SCENARIOS) { const live = runScenario(s); const r = replayHash(s, live); if (!r.ok || r.hash !== live.result.finalHash) problems.push(`${s.name}: replaying its input log does not rebuild the same world (${r.reason ?? 'hash differs'})`); }
  for (const p of problems) console.error(`ERROR: ${p}`);
  console.log(problems.length ? `qa:replay FAILED: ${problems.length} problem(s). If the sim change is intended: npm run qa:replay -- --record` : `qa:replay OK: ${SCENARIOS.length} scenarios match the golden and replay from their logs`);
  process.exit(problems.length ? 1 : 0);
}
