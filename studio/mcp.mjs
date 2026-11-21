#!/usr/bin/env node
// Studio MCP server entry point.  node studio/mcp.mjs --project <path> [--scope read|author|pack]
//   [--agent <name>] [--audit-log <file>] [--self-test] [--help]
// Speaks MCP over stdio. stdout carries protocol messages ONLY; everything else goes to stderr.

import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer, makeAudit, serveStdio } from './mcp/server.mjs';
import { SCOPES } from './mcp/registry.mjs';
import { ProjectError, openProject } from './mcp/project.mjs';
import { buildRegistry } from './mcp/tools/index.mjs';

// Guard: nothing may reach stdout by accident (a stray console.log would corrupt the stream).
console.log = console.info = console.debug = (...a) => console.error(...a);

const HELP = `Usage: node studio/mcp.mjs [options]
  --project <path>      repo root to serve (default: the repo containing this script)
  --scope <scope>       permission for this connection: ${SCOPES.join(' | ')} (default: read)
  --agent <name>        agent name to record (default: the client's self-reported name)
  --audit-log <file>    append one JSON line per tool call
  --self-test           spawn this server, run a real handshake and call, print a report
  --help
`;

let values;
try {
  ({ values } = parseArgs({
    options: {
      project: { type: 'string' }, scope: { type: 'string', default: 'read' }, agent: { type: 'string' },
      'audit-log': { type: 'string' }, 'self-test': { type: 'boolean' }, help: { type: 'boolean' },
    },
    strict: true,
  }));
} catch (e) {
  console.error(`studio-mcp: ${e.message}\n${HELP}`);
  process.exit(2);
}
if (values.help) { process.stdout.write(HELP); process.exit(0); }
if (!SCOPES.includes(values.scope)) { console.error(`studio-mcp: --scope must be one of ${SCOPES.join(', ')}`); process.exit(2); }

const here = dirname(fileURLToPath(import.meta.url));
// Default to the repo that holds this script, not the cwd: a worktree's own copy serves its own files.
const projectRoot = resolve(values.project ?? resolve(here, '..'));

if (values['self-test']) {
  const { runSelfTest } = await import('./mcp/self_test.mjs');
  process.exit(await runSelfTest({ projectRoot, entry: fileURLToPath(import.meta.url) }));
}

let project;
try {
  project = openProject(projectRoot);
} catch (e) {
  if (!(e instanceof ProjectError)) throw e;
  console.error(`studio-mcp: ${e.message}`);
  process.exit(2);
}
const server = new McpServer({
  registry: buildRegistry(), project, scope: values.scope, agent: values.agent, audit: makeAudit(values['audit-log']),
});
console.error(`studio-mcp: serving ${project.root} (scope ${values.scope}) on stdio`);
await serveStdio({ input: process.stdin, output: process.stdout, server });
