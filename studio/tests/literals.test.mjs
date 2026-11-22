// The studio directory holds no project. This scans EVERY text file under studio/ (not only studio/core,
// which has its own stricter test) for the names of one game: asset ids and prefixes, palette ids,
// directories under assets/ or tools/, scene and place names, a hex colour. A project says these things in
// its pack (studio.project.json) or in its own files; the studio only reads them.
//
// Not scanned: *.md (prose is rewritten with the docs) and binary files.
// ALLOWED lists the files that may name the project, and why. Keep it short and honest:
//  - the test files that use THIS repository as their fixture project (an agent reading them learns
//    what real data looks like), listed one by one so a new one has to be added on purpose;
//  - the evaluation harness (studio/mcp/eval) and the forge prototype, which record runs on this project.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const studio = fileURLToPath(new URL('../', import.meta.url));
const BANNED = [
  /(?<![A-Za-z])assets\/(raw|processed|atlases|manifest|audio|_fixtures|experiments|encounter|studio_)/, /(?<![A-Za-z])tools\/(generators|scripts|\.venvs|\.toolchains|skills)/,
  /palette\.json/, /vfx_index/, /approved-frames/, /inspector-revisions/, /preview-app/, /tien[-_ ]?nghich/i, /ti[êe]n ngh[ịi]ch/i,
  /xianxia/i, /pixellab/i, /longtime/i, /hengyue/i, /blood[_-]?sea/i, /evening[ _-]?bell/i, /drowned[ _-]?court/i, /courtyard/i,
  /['"`/ ](lt|mob|wl|ts|ui|bgm|sfx|prop|wp|pj)_[a-z]{3,}/, /hit_spark/, /#14101a/i, /manifest_[a-z]+\.json/,
];
const SCANNED = /\.(mjs|js|cjs|json|html|css|py|ts|toml|xml)$/;
// examples/ holds sample PROJECTS (data a stranger copies), not studio code: they name their own files by design.
const SKIP_DIRS = new Set(['node_modules', '.git', 'examples']);

// Test files that use this repository's own project as their fixture.
const FIXTURE_TESTS = new Set([
  'mcp/envelope.test.mjs',
  'mcp/dryrun.test.mjs',
  'mcp/frame-text.test.mjs',
  'mcp/shading-tool.test.mjs',
  'mcp/vfx-record.test.mjs',
  'mcp/audio-window.test.mjs',
  'mcp/preview-inspect.test.mjs',
  'core/tests/revisions-exports.test.mjs',
  'mcp/policy.test.mjs',
  'core/tests/standing.test.mjs',
  'mcp/review-standing.test.mjs',
  'ui/importer/import.test.mjs',
  'ui/tabs/overview/server.test.mjs',
  'mcp/prompt-tools.test.mjs',
  'mcp/figure-tools.test.mjs',
  'mcp/lineup-tools.test.mjs',
  'mcp/motion-tools.test.mjs',
  'mcp/timeline-tools.test.mjs',
  'ui/timeline/timeline.test.mjs',
  'ui/tabs/review/art-approvals.test.mjs',
  'ui/tabs/review/owner-approval-all-art.test.mjs',
  'audio/tests/determinism.test.mjs',
  'audio/tests/helpers.mjs',
  'audio/tests/images-compare-cli.test.mjs',
  'audio/tests/literals.test.mjs',
  'audio/tests/measure.test.mjs',
  'core/tests/adapters.test.mjs',
  'core/tests/atlas-proof.test.mjs',
  'core/tests/catalog.test.mjs',
  'core/tests/defects.test.mjs',
  'core/tests/export.test.mjs',
  'core/tests/gates.test.mjs',
  'core/tests/ledger.test.mjs',
  'core/tests/literals.test.mjs',
  'core/tests/pack.test.mjs',
  'forge/gates/tests/gates.test.mjs',
  'forge/motion/tests/library.test.mjs',
  'forge/rig/tests/biped.test.mjs',
  'forge/rig/tests/marten-parity.test.mjs',
  'forge/rig/tests/patch.test.mjs',
  'forge/tests/literals.test.mjs',
  'forge/tests/parity.test.mjs',
  'forge/tests/pipeline.test.mjs',
  'forge/tests/second-fixture.test.mjs',
  'mcp/audio-tools.test.mjs',
  'mcp/checks.test.mjs',
  'mcp/eval.test.mjs',
  'mcp/forge-tools.test.mjs',
  'mcp/handoff.test.mjs',
  'mcp/http.test.mjs',
  'mcp/humanonly-p3b.test.mjs',
  'mcp/humanonly.test.mjs',
  'mcp/review.test.mjs',
  'mcp/server.test.mjs',
  'mcp/takes.test.mjs',
  'mcp/toolchain-tools.test.mjs',
  'mcp/tools.test.mjs',
  'server/catalog-api.test.mjs',
  'server/editor-all.test.mjs',
  'server/editor.test.mjs',
  'tests/editor.test.mjs',
  'tests/literals.test.mjs',
  'tests/shell-browser.test.mjs',
  'ui/tabs/atlas/model.test.mjs',
  'ui/tabs/atlas/server.test.mjs',
  'ui/tabs/audio/contract.test.mjs',
  'ui/tabs/audio/model.test.mjs',
  'ui/tabs/audio/server.test.mjs',
  'ui/tabs/characters/characters-browser.mjs',
  'ui/tabs/characters/server.test.mjs',
  'ui/tabs/characters/state.test.mjs',
  'ui/tabs/jobs/server.test.mjs',
  'ui/tabs/objects/model.test.mjs',
  'ui/tabs/objects/server.test.mjs',
  'ui/tabs/objects/tools.test.mjs',
  'ui/tabs/review/model.test.mjs',
  'ui/tabs/review/server.test.mjs',
  'ui/tabs/sandbox/contract.test.mjs',
  'ui/tabs/sandbox/server.test.mjs',
  'ui/tabs/vfx/data.test.mjs',
  'ui/tabs/vfx/model.test.mjs',
  'ui/tabs/vfx/server.test.mjs',
  'ui/tests/router.test.mjs',
  'mcp/self_test.mjs',
  // PENDING: example ids in the MCP tool descriptions (and the source enum of catalog_search). These files are being
  // edited by another worker; the change is described in the PR that introduced this test. Remove these lines when done.
  'mcp/tools/asset_get.mjs',
  'mcp/tools/asset_plan.mjs',
  'mcp/tools/audio_render.mjs',
  'mcp/tools/catalog_search.mjs',
  'mcp/tools/frames_submit.mjs',
  'mcp/tools/metadata_set.mjs',
  'mcp/tools/pack.mjs',
  'mcp/tools/project_info.mjs',
  'mcp/tools/review_reply.mjs',
  'mcp/tools/scene_snapshot.mjs',
  'mcp/tools/template_get.mjs',
]);
// Records and harnesses of runs on this project.
const RECORDS = [/^mcp\/eval\//, /^mcp\/testkit\.mjs$/, /^forge\/prototype\//, /^forge\/rig\/tests\/fixtures\//];

async function walk(dir, out = []) {
  for (const e of await fs.readdir(dir, {withFileTypes: true})) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(path.join(dir, e.name), out); }
    else if (SCANNED.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

test('studio/ names no project outside the allowed fixtures', async () => {
  const files = await walk(studio);
  assert.ok(files.length > 150, `scanned ${files.length} files`);
  const hits = new Map();
  for (const file of files) {
    const rel = path.relative(studio, file).split(path.sep).join('/');
    if (RECORDS.some(re => re.test(rel))) continue;
    const lines = (await fs.readFile(file, 'utf8')).split('\n');
    lines.forEach((line, i) => BANNED.forEach(re => { if (re.test(line)) { if (!hits.has(rel)) hits.set(rel, []); hits.get(rel).push(`${i + 1}: ${re} ${line.trim().slice(0, 90)}`); } }));
  }
  const unexpected = [...hits.keys()].filter(f => !FIXTURE_TESTS.has(f));
  assert.deepEqual(unexpected.map(f => `${f}\n   ${hits.get(f).slice(0, 3).join('\n   ')}`), []);
  const stale = [...FIXTURE_TESTS].filter(f => !hits.has(f));
  assert.deepEqual(stale, [], 'allow-list entries that no longer need it: remove them');
});
