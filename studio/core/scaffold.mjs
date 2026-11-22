// `studio init`: write the files of a new, empty project. Pure data plus one writer.
//   - never overwrites an existing file (it is reported as skipped);
//   - never writes outside the target directory: every path below is fixed and relative, and the real path of
//     every directory it writes into is checked to stay inside the real target (a symlinked folder cannot redirect it).
// The starter is deliberately small and plain: eight colours, three size classes, one profile, no assets. It names no game.
import fs from 'node:fs/promises';
import path from 'node:path';

export const STARTER_PALETTE = [
  ['ink_1', '#1c1a24', 'ink'], ['ink_2', '#3b3850', 'ink'], ['stone_1', '#7a7890', 'stone'], ['stone_2', '#c4c2d0', 'stone'],
  ['leaf_1', '#3f7d4e', 'leaf'], ['leaf_2', '#8fc266', 'leaf'], ['sun_1', '#e8a23c', 'sun'], ['rose_1', '#c8506a', 'rose'],
];

const json = value => JSON.stringify(value, null, 2) + '\n';

/** The slug an id may have: lowercase letters, digits, - and _. */
export const slugOf = text => String(text).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+|-+$/g, '') || 'my-project';

export function starterPack({id, name}) {
  return {
    $schema: 'studio/schemas/project.schema.json',
    schema: 'studio.project', version: 1, id, name,
    palette: {file: 'art/colors.json'},
    sizeClasses: {sprite: {sizes: [[16, 16]]}, tile: {sizes: [[16, 16]]}, large: {sizes: [[32, 32]]}},
    rules: {alpha: 'binary', outline: {mode: 'silhouette', color: 'palette', borderIsEdge: false}},
    frameKeys: {sprite: 'sprite/{id}/{clip}_{direction}_{n}'},
    directories: {raw: {sprites: 'src/sprites'}, processed: {sprites: 'build/frames'}, atlases: {sprites: 'build/atlases'}, revisions: '.studio-db'},
    atlasProfiles: {web: {limit: 1024, padding: 0, extrude: 0, fixedSize: true}, mobile: {limit: 512, padding: 1, extrude: 1, fixedSize: false}},
    catalog: {
      categories: {sprite: {outline: true}, tile: {}},
      sources: [
        {id: 'sprites', kind: 'design-manifest', file: 'design/sprites.json', label: {en: 'Sprites'}, processed: 'sprites', raw: 'sprites', frameKeys: {sprites: 'sprite'}},
        {id: 'sound', kind: 'audio-plan', file: 'design/audio.json', label: {en: 'Sound'}, evidence: {packs: 'audio/packs', masters: 'audio/masters', sources: 'audio/sources'}},
      ],
    },
    editable: {overlay: 'records/overlay.json', groups: [{kind: 'processed-frames', source: 'sprites', keyPrefix: 'sprite/', pivot: {from: 'profile', field: 'pivot_px'},
      publish: {mode: 'none', reason: 'Nothing is published into shipped atlases from here yet.'}}]},
    policy: {stop: {maxFixRounds: 3, noProgressRounds: 2}},
    agentGuidance: {rules: ['Write the rules of your art here: palette use, outline, sizes. Agents read them when they connect.']},
    adapters: {interpreter: {runtime: 'node'}, commands: {}},
    ui: {
      brand: {mark: id.slice(0, 2).toUpperCase(), subtitle: {en: 'Pixel-art project', vi: 'Dự án pixel art'}},
      languages: ['en'],
      theme: {ink: 'ink_1', surface: 'ink_2', line: 'stone_1', muted: 'stone_2', text: 'stone_2', accent: 'leaf_2', accentSoft: 'leaf_1', gold: 'sun_1', goldSoft: 'sun_1', danger: 'rose_1'},
      categoryTabs: {sprite: 'characters', tile: 'objects'},
      tabs: {characters: {categories: ['sprite'], facings: ['south', 'east', 'north', 'west'], defaultFrameMs: 100, rawRoots: ['src/sprites']}, sandbox: {scenesDir: 'scenes'}},
      tools: [],
    },
  };
}

export const starterPalette = ({id}) => ({
  name: `${id}-starter`, version: 1, outline: STARTER_PALETTE[0][1], outline_id: STARTER_PALETTE[0][0],
  groups: [...new Set(STARTER_PALETTE.map(c => c[2]))],
  colors: STARTER_PALETTE.map(([cid, hex, group], i) => ({id: cid, index: i + 1, name: cid.replace('_', '-'), group, hex})),
});

export const starterDesign = () => ({
  schema: 'studio.design', version: 1,
  defaults: {readiness: 'planned', source: 'src/sprites/{id}/', processed: 'build/frames/{id}/{clip}_{direction}_{n}.png', export: 'build/atlases/{platform}/{chunk_group}/', key: 'sprite/{id}/{clip}_{direction}_{n}'},
  mobile: {page: [512, 512], padding: 1, extrude: 1, bytes_per_pixel: 4},
  chunks: {main: 1},
  profiles: {sprite: {category: 'sprite', native_px: [16, 16], pivot_px: [8, 14], directions: ['none'], clips: {idle: [1, 100]}}},
  assets: [],
});

export const starterAudio = () => ({schema_version: 1, status: 'planned', core: {}, extensions: {}});

/** Where the agent configs point: the studio's mcp.mjs, relative when it sits inside the project, absolute otherwise. */
export function mcpEntry(dir, studioDir) {
  const mcp = path.join(studioDir, 'mcp.mjs');
  const rel = path.relative(dir, mcp);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : mcp;
}

const SCOPE_NOTE = 'Read scope: an agent can look (project info, catalog, previews, QA) but not write. To let it create art, change "read" to "author" (and restart the agent).';

export function agentConfigs(dir, studioDir) {
  const entry = mcpEntry(dir, studioDir);
  const args = agent => [entry, '--project', '.', '--scope', 'read', ...(agent ? ['--agent', agent] : [])];
  return {
    '.mcp.json': json({mcpServers: {studio: {command: 'node', args: args()}}}),
    '.codex/config.toml': `# Codex project config, loaded after you trust this project.\n# ${SCOPE_NOTE}\n[mcp_servers.studio]\ncommand = "node"\nargs = ${JSON.stringify(args('codex'))}\nstartup_timeout_sec = 20\ndefault_tools_approval_mode = "writes"\n`,
    '.agents/mcp_config.json': json({mcpServers: {studio: {command: 'node', args: args('antigravity'), timeoutSeconds: 60}}}),
  };
}

export function readme({id, name}, dir, studioDir) {
  const cli = path.relative(dir, path.join(studioDir, 'cli.mjs'));
  const run = cli && !cli.startsWith('..') && !path.isAbsolute(cli) ? cli.split(path.sep).join('/') : path.join(studioDir, 'cli.mjs');
  return `# ${name}

A pixel-art project for the studio. Everything about it lives in \`studio.project.json\` (the project pack): palette, sizes, outline rule, frame names, directories. The studio reads it; it holds no game of its own.

\`\`\`
node ${run} check --project .       # is the pack complete? what is missing?
node ${run} serve --project .       # open http://127.0.0.1:4173/studio/
node ${run} doctor --project .      # Node version and optional tools
\`\`\`

## Layout

| Path | What |
|---|---|
| \`art/colors.json\` | The palette. Replace the starter colours with yours; keep one outline colour. |
| \`design/sprites.json\` | Profiles (size, pivot, directions, clips) and the planned assets. |
| \`design/audio.json\` | The cues you plan to make. |
| \`src/sprites/\` | Raw frames (never edited after they arrive). |
| \`build/frames/\`, \`build/atlases/\` | Processed frames and packed atlases. |
| \`records/\` | Review records. |
| \`scenes/\` | Sandbox scene documents. |
| \`.studio-db/\` | The studio's local database (revisions, reviews, jobs). Not for git. |

## Connect an agent (one is enough)

\`.mcp.json\` (Claude Code), \`.codex/config.toml\` (Codex) and \`.agents/mcp_config.json\` (Antigravity) are written at **read** scope: the agent can look, not write. To let it create art, change \`"read"\` to \`"author"\` in the config of the agent you use and restart it. No agent can approve art or sign an audio listening: only you can, in the Review tab.

When an agent asks for a review, look at the Review tab.
`;
}

export function projectFiles({id, name}, dir, studioDir) {
  const keep = '';
  return {
    'studio.project.json': json(starterPack({id, name})),
    'art/colors.json': json(starterPalette({id})),
    'design/sprites.json': json(starterDesign()),
    'design/audio.json': json(starterAudio()),
    'audio/packs/.gitkeep': keep, 'audio/masters/.gitkeep': keep, 'audio/sources/.gitkeep': keep,
    'src/sprites/.gitkeep': keep, 'build/frames/.gitkeep': keep, 'build/atlases/.gitkeep': keep, 'records/.gitkeep': keep, 'scenes/.gitkeep': keep,
    '.gitignore': '.studio-db/\n',
    ...agentConfigs(dir, studioDir),
    'README.md': readme({id, name}, dir, studioDir),
  };
}

/** The real path of the deepest ancestor of `p` that exists (p itself when it does). */
async function nearestExisting(p) {
  for (let at = p;; at = path.dirname(at)) {
    try { return await fs.realpath(at); } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
    if (path.dirname(at) === at) return at;
  }
}

/**
 * Scaffold a project into `dir`. Returns {dir, created: [rel], skipped: [rel]}.
 * Throws when `dir` exists and is not a directory.
 */
export async function scaffold(dirArg, studioDir, {name, id} = {}) {
  const dir = path.resolve(dirArg);
  const projectName = name ?? path.basename(dir);
  const projectId = id ?? slugOf(projectName);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(projectId)) throw new Error(`"${projectId}" is not a valid project id (lowercase letters, digits, - and _)`);
  await fs.mkdir(dir, {recursive: true});
  const realDir = await fs.realpath(dir);
  if (!(await fs.stat(dir)).isDirectory()) throw new Error(`${dir} is not a directory`);
  const created = [], skipped = [];
  for (const [rel, body] of Object.entries(projectFiles({id: projectId, name: projectName}, realDir, studioDir))) {
    const target = path.join(realDir, rel);
    // Resolve the nearest EXISTING ancestor first and refuse before creating anything: a symlinked folder must not be written through.
    const ancestor = await nearestExisting(path.dirname(target));
    if (ancestor !== realDir && !ancestor.startsWith(realDir + path.sep)) { skipped.push(`${rel} (its folder leads outside the project)`); continue; }
    await fs.mkdir(path.dirname(target), {recursive: true});
    try { await fs.writeFile(target, body, {flag: 'wx'}); created.push(rel); }
    catch (error) { if (error.code === 'EEXIST') skipped.push(rel); else throw error; }
  }
  return {dir: realDir, id: projectId, name: projectName, created, skipped};
}
