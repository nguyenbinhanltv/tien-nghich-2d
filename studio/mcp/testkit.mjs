// Test and evaluation helpers: a throwaway project built from the real repo's files, and valid frames.
// Nothing here ships to a harness; it exists so tests never write into the real repository.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePixels } from '../core/png.mjs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const BASE_FILES = ['studio.project.json', 'assets/manifest.json', 'assets/manifest_longtime.json', 'assets/audio_manifest.json',
  'assets/processed/vfx/vfx_index.json', 'tools/generators/palette.json',
  'assets/raw/longtime/lt_kiln_keeper/contact_4x.png', 'assets/raw/longtime/lt_ink_marten/contact_4x.png'];   // the pack's locked reference images
// Directories copied whole so milestones, QA and previews have real frames to judge.
const BASE_DIRS = ['assets/processed_longtime/lt_kiln_keeper', 'assets/atlases_longtime', 'assets/processed/ui/ui_card_frame'];

/** Is the Python toolchain (project venv and SpriteFX venv + clone) present on this machine? Tests that need it skip otherwise. */
export const HAVE_PYTHON = existsSync(join(REPO, 'tools/.venvs/project/bin/python'));
export const HAVE_SPRITEFX = existsSync(join(REPO, 'tools/.venvs/spritefx/bin/python')) && existsSync(join(REPO, 'tools/skills/spritefx/fx'));

/**
 * Build a temp project. Returns {root, cleanup}. git: also `git init -b main` and commit everything.
 * toolchain: link the Python environments and SpriteFX clone, and copy the registered generator and VFX palettes,
 * so the programs the pack registers can really run there.
 */
export function makeProject({ git = false, extraDirs = [], toolchain = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'studio-proj-'));
  for (const f of BASE_FILES) { mkdirSync(dirname(join(root, f)), { recursive: true }); cpSync(join(REPO, f), join(root, f)); }
  for (const d of [...BASE_DIRS, ...extraDirs]) { mkdirSync(dirname(join(root, d)), { recursive: true }); cpSync(join(REPO, d), join(root, d), { recursive: true }); }
  if (toolchain) {
    mkdirSync(join(root, 'tools/skills'), { recursive: true });
    for (const link of ['tools/.venvs', 'tools/skills/spritefx']) if (existsSync(join(REPO, link))) symlinkSync(join(REPO, link), join(root, link));
    cpSync(join(REPO, 'tools/generators/studio_primitives.py'), join(root, 'tools/generators/studio_primitives.py'));
    mkdirSync(join(root, 'tools/generators/vfx_specs'), { recursive: true });
    cpSync(join(REPO, 'tools/generators/vfx_specs/palettes'), join(root, 'tools/generators/vfx_specs/palettes'), { recursive: true });
  }
  if (git) {
    const run = (...a) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { stdio: 'ignore' });
    run('init', '-b', 'main'); run('add', '-A'); run('commit', '-m', 'fixture');
  }
  return { root, cleanup: () => import('node:fs').then((fs) => fs.rmSync(root, { recursive: true, force: true })) };
}

/** The palette as {ink, colors: [0xRRGGBB]} read from the real palette file. */
export function loadPalette() {
  const p = JSON.parse(readFileSync(join(REPO, 'tools/generators/palette.json'), 'utf8'));
  const int = (hex) => parseInt(hex.slice(1), 16);
  // The slice keeps the fixtures byte-identical to what they were before the orange ramp (palette indices 41 to 43)
  // was appended: a frame is chosen by `index % colors.length`, so a longer list would move every fixture frame.
  return { ink: int(p.outline), colors: p.colors.map((c) => int(c.hex)).filter((c) => c !== int(p.outline)).slice(0, 39) };
}

/**
 * A valid w x h native frame: a filled body in palette colours with a 1px ink outline. `variant` changes
 * the body colour and a feature pixel so different frames differ. `damage` is a list of
 * {x, y, kind: 'alpha' | 'color' | 'gap'} applied afterwards. Returns {png, pixels}.
 */
export function makeFrame(w, h, { variant = 0, damage = [] } = {}) {
  const { ink, colors } = loadPalette();
  const body = colors[(variant * 3) % colors.length], accent = colors[(variant * 3 + 7) % colors.length];
  const pixels = Buffer.alloc(w * h * 4);
  const set = (x, y, c, a = 255) => { const k = (y * w + x) * 4; pixels[k] = c >> 16 & 255; pixels[k + 1] = c >> 8 & 255; pixels[k + 2] = c & 255; pixels[k + 3] = a; };
  const x0 = Math.floor(w * 0.2), x1 = Math.ceil(w * 0.8) - 1, y0 = Math.floor(h * 0.12), y1 = Math.floor(h * 0.9);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, (x === x0 || x === x1 || y === y0 || y === y1) ? ink : body);
  set(x0 + 3 + (variant % 5), y0 + 4, accent);
  for (const d of damage) {
    if (d.kind === 'alpha') set(d.x, d.y, body, 128);
    else if (d.kind === 'color') set(d.x, d.y, 0x010203);
    else if (d.kind === 'gap') set(d.x, d.y, body); // an edge pixel that is not the outline colour
  }
  return { png: encodePixels(w, h, pixels), pixels };
}

/** Write a frame PNG into a project (for tools that take file paths); returns the relative path. */
export function writeFrame(root, rel, frame) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), frame.png);
  return rel;
}

export const sha = (buf) => import('node:crypto').then(({ createHash }) => createHash('sha256').update(buf).digest('hex'));
export const shaSync = (buf) => execFileSync('node', ['-e', 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(0)).digest("hex"))'], { input: buf }).toString();
export const HASH = 'a'.repeat(64);

// ---- in-process connection ----------------------------------------------------------------
import { McpServer } from './server.mjs';
import { openProject } from './project.mjs';
import { buildRegistry } from './tools/index.mjs';
import { JobRunner } from '../core/jobs.mjs';
import { META_CLIENT_INFO, META_VERSION } from './protocol.mjs';

const MODERN = { [META_VERSION]: '2026-07-28', [META_CLIENT_INFO]: { name: 'testkit', version: '1' } };

/**
 * An in-process MCP connection to a project: the same McpServer the stdio and HTTP transports wrap.
 * Each call to connect() is a new SESSION (the server assigns the id), which is what the
 * independent-check rule is about. Pass the same `project`/`jobs` to share state between sessions.
 */
export function connect(rootOrProject, { scope = 'author', agent = 'tester', policy, jobs = new JobRunner(), session } = {}) {
  const project = typeof rootOrProject === 'string' ? openProject(rootOrProject) : rootOrProject;
  const server = new McpServer({ registry: buildRegistry(), project, scope, agent, policy, jobs, session });
  let id = 0;
  const rpc = (method, params = {}) => server.handleMessage({ jsonrpc: '2.0', id: ++id, method, params: { ...params, _meta: MODERN } });
  const call = async (name, args = {}) => {
    const r = await rpc('tools/call', { name, arguments: args });
    return r.error ? { rpcError: r.error } : r.result;
  };
  /** The parsed structuredContent of a successful call; throws with the message if it failed. */
  const ok = async (name, args) => {
    const r = await call(name, args);
    if (r.rpcError || r.isError) throw new Error(`${name} failed: ${JSON.stringify(r.rpcError ?? r.content?.[0]?.text)}`);
    return r.structuredContent;
  };
  return { server, project, call, ok, rpc, session: server.session, jobs };
}

/** Frame entries for studio_frames_submit: every frame of a clip in one direction. */
export function clipFrames(clip, direction, count, w = 32, h = 32, variantBase = 0) {
  return Array.from({ length: count }, (_, n) => ({ clip, direction, n, pngBase64: makeFrame(w, h, { variant: variantBase + n }).png.toString('base64') }));
}

export const PROVENANCE = { tool: 'testkit generator', prompt: 'a seed broker with a carrying pole', sourceHash: HASH };
