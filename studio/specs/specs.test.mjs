import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSpecs, testNames } from './check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const studio = path.dirname(here);
const repo = path.dirname(studio);

function* testFiles(dir) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && full !== here) yield* testFiles(full); }
    else if (e.name.endsWith('.test.mjs')) yield full;
  }
}

const readAll = (files, base) => Object.fromEntries(files.map(f => [path.relative(base, f), fs.readFileSync(f, 'utf8')]));

test('every behaviour spec has a test that names its id, and every id a test names is a spec', () => {
  const specs = readAll(fs.readdirSync(here).filter(f => f.endsWith('.md')).map(f => path.join(here, f)), here);
  const tests = readAll([...testFiles(studio)], repo);
  const {problems, ids} = checkSpecs({specs, tests});
  assert.deepEqual(problems, []);
  assert.ok(ids.size >= 25, 'the specs define their behaviours');
});

test('the four first behaviours are specified: human-only approval, staging, no sound before a click, loopback only', () => {
  const text = Object.values(readAll(fs.readdirSync(here).filter(f => f.endsWith('.md')).map(f => path.join(here, f)), here)).join('\n');
  for (const mark of ['(human-only)', '(staging)', '(silent)', '(loopback)']) assert.ok(text.includes(mark), mark);
});

// The checker itself, on small made-up inputs. The names are assembled so that this file does not look like a test file to the scanner.
const call = (name) => `${'te'}${'st'}('${name}', () => {});`;

test('the checker reports a spec id with no test, an unknown id under a known prefix, and an unknown prefix at the start of a name', () => {
  const specs = {'review.md': '- **REVIEW-001** a\n- **REVIEW-002** b\n', 'jobs.md': '- **JOBS-001** c\n'};
  const tests = {'a.test.mjs': [call('REVIEW-001: fine'), call('REVIEW-009: unknown number'), call('BOGUS-001: unknown prefix'), call('mentions SHA-256 in the middle'), call('JOBS-001 and REVIEW-001')].join('\n')};
  const {problems, ids} = checkSpecs({specs, tests});
  assert.equal(problems.length, 3, problems.join('\n'));
  assert.ok(problems.some(p => /REVIEW-002 has no test/.test(p)));
  assert.ok(problems.some(p => /names REVIEW-009, which no spec defines/.test(p)));
  assert.ok(problems.some(p => /starts with BOGUS-001/.test(p)));
  assert.equal(ids.get('REVIEW-001').length, 2, 'one test may name several ids and several tests one id');
});

test('the checker reports a repeated id, an id in the wrong file and a malformed line; a comment or string is not a test name', () => {
  const specs = {'review.md': '- **REVIEW-001** a\n- **REVIEW-001** again\n- **JOBS-002** wrong file\n- **REVIEW-3** malformed\n', 'jobs.md': '- **JOBS-001** c\n'};
  const tests = {'a.test.mjs': [call('REVIEW-001 JOBS-001 JOBS-002'), "// test('REVIEW-777: a comment')", "const s = \"REVIEW-778\";"].join('\n')};
  const {problems} = checkSpecs({specs, tests});
  assert.ok(problems.some(p => /REVIEW-001 is already defined/.test(p)));
  assert.ok(problems.some(p => /JOBS-002 does not belong in review.md/.test(p)));
  assert.ok(problems.some(p => /review.md:4: a behaviour line must start with/.test(p)));
  assert.equal(testNames("const x = test(`a ${b} REVIEW-001`, f); describe('d', g); it.skip(\"e\", h);").length, 3);
});
