// The evaluation, checked offline. No model is involved: (1) the scene's ground truth, computed without
// the studio tools, equals the answers in questions.xml; (2) every question can be answered using
// nothing but studio tool calls through the real server, by an oracle that does what a good agent
// would. Together they show the questions are answerable, verifiable and stable. Running them with
// a real agent is `node studio/mcp/eval/run.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScene } from './eval/scene.mjs';
import { digest, normalize, parseQuestions } from './eval/run.mjs';
import { connect } from './testkit.mjs';
import { openProject } from './project.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const questions = parseQuestions(readFileSync(join(HERE, 'eval/questions.xml'), 'utf8'));

test('five read-only questions, each with one short verifiable answer', () => {
  assert.equal(questions.length, 5);
  assert.deepEqual(questions.map((q) => q.n), [1, 2, 3, 4, 5]);
  for (const q of questions) {
    assert.ok(q.question.length > 80 && q.question.length < 700, `Q${q.n} length`);
    assert.ok(q.answer.length > 0 && q.answer.length < 40, `Q${q.n} answer is one short value`);
    assert.match(q.question, /Answer (with|as)/, `Q${q.n} says how to format the answer`);
    assert.doesNotMatch(q.question, /\b(create|submit|approve|delete|write|record)\b/i, `Q${q.n} asks for no state change`);
  }
});

test('the answers in questions.xml equal ground truth computed without the studio tools', async () => {
  const scene = await buildScene();
  try {
    const t = scene.truth;
    assert.deepEqual(questions.map((q) => normalize(q.answer)), [t.q1, t.q2, t.q3, t.q4, t.q5].map(normalize));
    assert.equal(t.q1Asset, 'lt_furnace_ferryman');
    assert.deepEqual(t.q3Pixel, { frame: 'idle_south_2', x: 14, y: 15, hex: '#010203' });
    assert.equal(t.q4Rows, 1, 'exactly one human comment mentions the pole, so Q4 has one answer');
  } finally { await scene.cleanup(); }
});

test('every question is answerable with studio tool calls alone (a read-scope oracle, in-process)', async () => {
  const scene = await buildScene();
  try {
    const c = connect(openProject(scene.root), { scope: 'read', agent: 'oracle' });
    const used = new Set();
    const ok = (name, args) => { used.add(name); return c.ok(name, args); };
    const answers = [];

    // Q1: find the planned ember_delta boss, then count its frames from its spec.
    const bosses = await ok('studio_catalog_search', { source: 'longtime', category: 'boss', chunk: 'ember_delta', status: 'planned' });
    assert.equal(bosses.total, 1);
    const spec = (await ok('studio_asset_get', { assetId: bosses.results[0].id, sections: ['spec'] })).spec;
    answers.push(String(Object.values(spec.clips).reduce((n, cl) => n + cl.frames, 0) * spec.directions.length));

    // Q2: every planned boss's chunk, then every planned asset in those chunks (paging through facets/results).
    const allBosses = await ok('studio_catalog_search', { source: 'longtime', category: 'boss', status: 'planned', limit: 100 });
    const chunks = [...new Set(allBosses.results.map((r) => r.chunk))];
    let total = 0;
    for (const chunk of chunks) total += (await ok('studio_catalog_search', { source: 'longtime', chunk, status: 'planned', limit: 1 })).total;
    answers.push(String(total));

    // Q3: the preview shows which frame is red; the QA run gives the colour.
    const sheet = await ok('studio_preview_render', { assetId: 'lt_seed_broker' });
    const bad = sheet.layout.rows[0].status.indexOf('error');
    const qa = await ok('studio_qa_run', { assetId: 'lt_seed_broker', detail: 'frames' });
    const frame = qa.frames.find((f) => f.name === `idle_south_${bad}`);
    answers.push(`${frame.name} ${frame.defects.find((d) => d.code === 'off_palette').color}`);

    // Q4: read the reviews and find the open human comment that is about what the broker carries.
    const reviews = await ok('studio_review_list', { assetId: 'lt_seed_broker', detail: 'full' });
    const item = reviews.items.find((i) => i.comments.some((cm) => cm.by === 'human' && /pole|carrying/i.test(cm.text)));
    answers.push(`${item.key.split('/').pop()} ${item.status}`);

    // Q5: the recorded checks and whether the newest independent one is current.
    const checks = (await ok('studio_asset_get', { assetId: 'lt_seed_broker', sections: ['checks'] })).checks;
    const independent = checks.find((ch) => ch.independent && ch.pass);
    answers.push(`${independent.agent} ${independent.current ? 'yes' : 'no'}`);

    assert.deepEqual(answers.map(normalize), questions.map((q) => normalize(q.answer)));
    for (const tool of ['studio_catalog_search', 'studio_asset_get', 'studio_preview_render', 'studio_qa_run', 'studio_review_list']) assert.ok(used.has(tool), `${tool} is exercised`);
    // And nothing was written: the read-scope oracle changed no file in the scene.
  } finally { await scene.cleanup(); }
});

test('the runner parses questions and agent transcripts', () => {
  assert.equal(normalize('  `idle_south_2   #010203`. '), 'idle_south_2 #010203');
  assert.equal(normalize('Claude-Code NO'), 'claude-code no');
  const lines = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__studio__studio_asset_get', input: { assetId: 'x' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'No asset "x"' }] }] } }),
    JSON.stringify({ type: 'result', result: 'thinking...\nANSWER: 72', num_turns: 3, duration_ms: 1200, total_cost_usd: 0.01 }),
    'not json',
  ];
  const d = digest(lines);
  assert.deepEqual([d.answer, d.calls.length, d.errors[0].tool, d.turns], ['72', 1, 'studio_asset_get', 3]);
  assert.equal(digest([JSON.stringify({ type: 'result', result: 'no final line' })]).answer, null);
});

// ---- the second half (forge, toolchain, audio) -------------------------------------------------------
import { buildForgeScene } from './eval/scene2.mjs';
import { HAVE_PYTHON } from './testkit.mjs';

const questions2 = parseQuestions(readFileSync(join(HERE, 'eval/questions2.xml'), 'utf8'));

test('second half: five questions, each with one short verifiable answer; the two halves make ten', () => {
  assert.equal(questions2.length, 5);
  assert.equal(questions.length + questions2.length, 10, 'the plan requires ten');
  for (const q of questions2) {
    assert.ok(q.question.length > 80 && q.question.length < 800, `Q${q.n + 5} length`);
    assert.ok(q.answer.length > 0 && q.answer.length < 60, `Q${q.n + 5} answer is one short value`);
    assert.match(q.question, /Answer (with|as)/, `Q${q.n + 5} says how to format the answer`);
  }
  assert.match(questions2.map((q) => q.question).join(' '), /do not commit anything/);
});

test('second half: the answers equal ground truth computed without the studio tools', { skip: HAVE_PYTHON ? false : 'Python toolchain not available' }, async () => {
  const scene = await buildForgeScene();
  try {
    const t = scene.truth;
    assert.deepEqual(questions2.map((q) => normalize(q.answer)), [t.q6, t.q7, t.q8, t.q9, t.q10].map(normalize));
    assert.equal(t.q8Detail[0].peak > t.q8Detail[1].peak, true, 'candidate 1 is the louder one');
  } finally { await scene.cleanup(); }
});

test('second half: every question is answerable with studio tool calls alone (an oracle at author scope, in-process)', { skip: HAVE_PYTHON ? false : 'Python toolchain not available' }, async () => {
  const scene = await buildForgeScene();
  try {
    const c = connect(openProject(scene.root), { scope: 'author', agent: 'oracle' });
    const used = new Set();
    const ok = (name, args) => { used.add(name); return c.ok(name, args); };
    const answers = [];

    // Q6: ask what routes the forge recommends, then ask for the pose sheet of the locomotion clip.
    const tpl = await ok('studio_template_get', { assetId: 'lt_reed_crane' });
    const clip = tpl.clips.find((x) => x.route === 'pose-sheet').name;
    const sheet = await ok('studio_template_get', { assetId: 'lt_reed_crane', kind: 'pose-sheet', clip });
    answers.push(`${clip}: ${sheet.poseClips.clips[clip].keys.join(', ')}`);

    // Q7: the provenance of the frames names the sheet hash.
    answers.push((await ok('studio_asset_get', { assetId: 'lt_reed_crane', sections: ['provenance'] })).provenance.latest.sourceHash.slice(0, 12));

    // Q8: the candidates list their peaks and durations.
    const cands = (await ok('studio_asset_get', { assetId: 'sfx_step', sections: ['audio'] })).audio.candidates;
    const loudest = cands.reduce((a, b) => (b.peakDbfs > a.peakDbfs ? b : a));
    answers.push(`${loudest.version} ${loudest.durationMs}`);

    // Q9: a trial run of the registered generator, nothing committed.
    const run = await ok('studio_generator_run', { assetId: 'lt_icon_realm_step', generator: 'primitives', params: { shape: 'ring', size: 16, fill: 'jade_03', accent: 'bronze_04' }, seed: 7 });
    answers.push(run.files[0].sha256.slice(0, 10));

    // Q10: a staging pack of the chunk tells whether it fits and what it is allowed.
    const pack = await ok('studio_pack', { chunk: 'abode', platform: 'mobile' });
    answers.push(`${pack.mobile.budget.pass ? 'yes' : 'no'} ${pack.mobile.budget.pages.ceiling}`);

    assert.deepEqual(answers.map(normalize), questions2.map((q) => normalize(q.answer)));
    for (const tool of ['studio_template_get', 'studio_asset_get', 'studio_generator_run', 'studio_pack']) assert.ok(used.has(tool), `${tool} is exercised`);
    const raw = (id) => join(scene.root, 'assets/raw/longtime', id);
    assert.equal((await import('node:fs')).existsSync(join(raw('lt_icon_realm_step'), 'frames')), false, 'the trial run committed nothing');
  } finally { await scene.cleanup(); }
});
