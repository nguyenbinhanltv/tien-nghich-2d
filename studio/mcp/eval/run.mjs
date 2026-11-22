#!/usr/bin/env node
// Run the studio MCP evaluation as a real agent (headless Claude Code) against the real server.
//   node studio/mcp/eval/run.mjs [--set 1|2|all] [--only 1,3] [--model <id>] [--keep] [--out <file.json>] [--max-turns 40]
// Set 1 (questions 1-5, read scope) is about the context, checking and review tools; set 2 (questions 6-10, author scope
// so the agent can run trial calls that write only scratch) is about the forge, toolchain and audio tools.
// The agent gets ONLY the studio tools (no shell, no file access), the scope of its set, and a
// throwaway scene. Needs the `claude` CLI and its login; it is not part of `node --test`.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildScene } from './scene.mjs';
import { buildForgeScene } from './scene2.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, '..', '..', 'mcp.mjs');

export function parseQuestions(xml) {
  return [...xml.matchAll(/<qa_pair>\s*<question>([\s\S]*?)<\/question>\s*<answer>([\s\S]*?)<\/answer>\s*<\/qa_pair>/g)]
    .map((m, i) => ({ n: i + 1, question: m[1].trim(), answer: m[2].trim() }));
}

export const normalize = (s) => String(s ?? '').trim().replace(/^[`"'\s]+|[`"'\s.]+$/g, '').replace(/\s+/g, ' ').toLowerCase();

const PROMPT = (q) => `You are answering a question about an asset project using ONLY the "studio" MCP tools (their names start with studio_). You have no shell and no file access. ` +
  `Call whatever tools you need, as many times as you need, then give your answer.\n\nQuestion: ${q}\n\n` +
  `Finish with one last line in exactly this form and nothing after it:\nANSWER: <your answer>`;

/** Pull what matters out of one stream-json run. */
export function digest(lines) {
  const calls = [], errors = [];
  const names = new Map();
  let result = null;
  for (const line of lines) {
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type === 'assistant') for (const c of m.message?.content ?? []) if (c.type === 'tool_use') { calls.push({ name: c.name.replace(/^mcp__studio__/, ''), input: c.input }); names.set(c.id, c.name); }
    if (m.type === 'user') for (const c of m.message?.content ?? []) {
      if (c.type === 'tool_result' && c.is_error) errors.push({ tool: (names.get(c.tool_use_id) ?? '?').replace(/^mcp__studio__/, ''), text: String(typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 300) });
    }
    if (m.type === 'result') result = m;
  }
  const text = result?.result ?? '';
  const answer = /^ANSWER:\s*(.+)$/m.exec(text)?.[1] ?? null;
  return { calls, errors, answer, text, turns: result?.num_turns, ms: result?.duration_ms, costUsd: result?.total_cost_usd, isError: result?.is_error };
}

function runClaude(prompt, { mcpConfig, model, maxTurns }) {
  return new Promise((resolveRun) => {
    const args = ['-p', prompt, '--mcp-config', mcpConfig, '--strict-mcp-config', '--tools', '', '--allowedTools', 'mcp__studio__*',
      '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--max-turns', String(maxTurns), ...(model ? ['--model', model] : [])];
    const p = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolveRun({ code, lines: out.split('\n').filter(Boolean), err }));
  });
}

export const SETS = {
  1: { questions: 'questions.xml', build: buildScene, scope: 'read', offset: 0 },
  2: { questions: 'questions2.xml', build: buildForgeScene, scope: 'author', offset: 5 },
};

async function main() {
  const { values } = parseArgs({ options: { set: { type: 'string', default: 'all' }, only: { type: 'string' }, model: { type: 'string' }, keep: { type: 'boolean' }, out: { type: 'string' }, 'max-turns': { type: 'string', default: '40' } } });
  const only = values.only ? new Set(values.only.split(',').map(Number)) : null;
  const sets = values.set === 'all' ? [1, 2] : [Number(values.set)];
  const rows = [];
  for (const setNo of sets) {
    const set = SETS[setNo];
    if (!set) throw new Error(`--set must be 1, 2 or all`);
    const questions = parseQuestions(readFileSync(join(HERE, set.questions), 'utf8')).map((q) => ({ ...q, n: q.n + set.offset }));
    if (only && !questions.some((q) => only.has(q.n))) continue;
    const scene = await set.build();
    const dir = join(tmpdir(), `studio-eval-${process.pid}-${setNo}`);
    mkdirSync(dir, { recursive: true });
    const mcpConfig = join(dir, 'mcp.json');
    writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { studio: { command: process.execPath, args: [ENTRY, '--project', scene.root, '--scope', set.scope, '--agent', 'eval'] } } }));
    try {
      for (const q of questions) {
        if (only && !only.has(q.n)) continue;
        process.stderr.write(`Q${q.n}: running (scope ${set.scope})...\n`);
        const run = await runClaude(PROMPT(q.question), { mcpConfig, model: values.model, maxTurns: values['max-turns'] });
        const d = digest(run.lines);
        const correct = d.answer !== null && normalize(d.answer) === normalize(q.answer);
        rows.push({ n: q.n, set: setNo, scope: set.scope, expected: q.answer, got: d.answer, correct, toolCalls: d.calls.length, tools: [...new Set(d.calls.map((c) => c.name))], toolErrors: d.errors, turns: d.turns, ms: d.ms, costUsd: d.costUsd, exit: run.code,
          ...(d.answer === null ? { tail: d.text.slice(-300), stderr: run.err.slice(0, 300) } : {}) });
        process.stderr.write(`Q${q.n}: ${correct ? 'correct' : 'WRONG'} (expected "${q.answer}", got "${d.answer}") in ${d.calls.length} tool calls, ${d.errors.length} tool errors\n`);
      }
    } finally { if (!values.keep) await scene.cleanup(); }
  }
  const summary = { ranAt: new Date().toISOString(), model: values.model ?? 'default', agent: 'Claude Code headless', correct: rows.filter((r) => r.correct).length, total: rows.length, rows };
  if (values.out) writeFileSync(values.out, JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  process.exitCode = summary.correct === summary.total ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
