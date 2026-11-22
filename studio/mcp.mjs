#!/usr/bin/env node
// Pixel Kiln MCP server entry point.  node studio/mcp.mjs --project <path> [--scope read|author|pack]
//   [--agent <name>] [--audit-log <file>] [--max-line-bytes <n>] [--library-dir <abs>] [--skip-independent-check]
//   [--self-test] [--help]
//   node studio/mcp.mjs --issue-token --agent <name> --scope <scope> | --list-tokens | --revoke-token <id>   (HTTP bearer tokens)
// Speaks MCP over stdio. stdout carries protocol messages ONLY; everything else goes to stderr.

import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MAX_LINE_BYTES, McpServer, makeAudit, serveStdio } from './mcp/server.mjs';
import { SCOPES } from './mcp/registry.mjs';
import { ProjectError, openProject } from './mcp/project.mjs';
import { buildRegistry } from './mcp/tools/index.mjs';
import { JobRunner } from './core/jobs.mjs';

// Guard: nothing may reach stdout by accident (a stray console.log would corrupt the stream).
console.log = console.info = console.debug = (...a) => console.error(...a);

const HELP = `Pixel Kiln MCP server.
Usage: node studio/mcp.mjs [options]
  --project <path>      repo root to serve (default: the repo containing this script)
  --scope <scope>       permission for this connection: ${SCOPES.join(' | ')} (default: read)
  --agent <name>        agent name to record (default: the client's self-reported name)
  --audit-log <file>    append one JSON line per tool call
  --max-line-bytes <n>  refuse input lines longer than n bytes (default ${DEFAULT_MAX_LINE_BYTES})
  --library-dir <abs>   revision library directory (default: the pack's revisions directory under the project)
  --skip-independent-check   LOCAL EXPERIMENTS ONLY: let studio_review_request run without another session's check
  --issue-token         print a new HTTP bearer token for --agent and --scope (shown once), then exit
  --list-tokens         list issued tokens (never the secrets), then exit
  --revoke-token <id>   revoke a token, then exit
  --self-test           spawn this server, run a real handshake and call, print a report
  --help
`;

let values;
try {
  ({ values } = parseArgs({
    options: {
      project: { type: 'string' }, scope: { type: 'string', default: 'read' }, agent: { type: 'string' },
      'audit-log': { type: 'string' }, 'max-line-bytes': { type: 'string' }, 'library-dir': { type: 'string' }, 'skip-independent-check': { type: 'boolean' }, 'issue-token': { type: 'boolean' }, 'list-tokens': { type: 'boolean' }, 'revoke-token': { type: 'string' }, 'self-test': { type: 'boolean' }, help: { type: 'boolean' },
    },
    strict: true,
  }));
} catch (e) {
  console.error(`pixel-kiln-mcp: ${e.message}\n${HELP}`);
  process.exit(2);
}
if (values.help) { process.stdout.write(HELP); process.exit(0); }
if (!SCOPES.includes(values.scope)) { console.error(`pixel-kiln-mcp: --scope must be one of ${SCOPES.join(', ')}`); process.exit(2); }

const maxLineBytes = values['max-line-bytes'] === undefined ? DEFAULT_MAX_LINE_BYTES : Number(values['max-line-bytes']);
if (!Number.isInteger(maxLineBytes) || maxLineBytes < 256) { console.error('pixel-kiln-mcp: --max-line-bytes must be an integer >= 256'); process.exit(2); }

const here = dirname(fileURLToPath(import.meta.url));
// Default to the repo that holds this script, not the cwd: a worktree's own copy serves its own files.
const projectRoot = resolve(values.project ?? resolve(here, '..'));

if (values['self-test']) {
  const { runSelfTest } = await import('./mcp/self_test.mjs');
  process.exit(await runSelfTest({ projectRoot, entry: fileURLToPath(import.meta.url) }));
}

let project;
try {
  project = openProject(projectRoot, { libraryDir: values['library-dir'] });
} catch (e) {
  if (!(e instanceof ProjectError)) throw e;
  console.error(`pixel-kiln-mcp: ${e.message}`);
  process.exit(2);
}
if (values['issue-token'] || values['list-tokens'] || values['revoke-token']) {
  const { TokenStore } = await import('./mcp/tokens.mjs');
  const tokens = new TokenStore(project.workspace.libraryDir());
  try {
    if (values['issue-token']) {
      if (!values.agent) throw new Error('--issue-token needs --agent <name>');
      const t = tokens.issue({ agent: values.agent, scope: values.scope });
      process.stdout.write(`Token for ${t.agent} (scope ${t.scope}), id ${t.id}. It is shown once and only its hash is kept.\nKeep it in an environment variable, never in a file that is committed:\n\n  ${t.token}\n`);
    } else if (values['list-tokens']) {
      process.stdout.write(JSON.stringify(tokens.list(), null, 2) + '\n');
    } else {
      if (!tokens.revoke(values['revoke-token'])) throw new Error(`no token with id ${values['revoke-token']}`);
      process.stdout.write(`revoked ${values['revoke-token']}\n`);
    }
  } catch (e) { console.error(`pixel-kiln-mcp: ${e.message}`); process.exit(2); }
  project.close();
  process.exit(0);
}

const server = new McpServer({
  registry: buildRegistry(), project, scope: values.scope, agent: values.agent, audit: makeAudit(values['audit-log']),
  jobs: new JobRunner(), policy: { requireIndependentCheck: !values['skip-independent-check'] },
});
console.error(`pixel-kiln-mcp: serving ${project.root} (scope ${values.scope}) on stdio`);
await serveStdio({ input: process.stdin, output: process.stdout, server, maxLineBytes });
project.close();
