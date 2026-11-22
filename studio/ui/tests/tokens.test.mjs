// Lane 2A: tokens.css defines the whole --ui-* contract, the pack's 18 theme roles pass WCAG, the brand seal is a valid 12x12 grid, fonts are shipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ui = fileURLToPath(new URL('../', import.meta.url));
const studio = fileURLToPath(new URL('../../', import.meta.url));
const read = f => fs.readFileSync(ui + f, 'utf8');
const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = strip(read('tokens.css'));

test('TOKENS-001: tokens.css defines every --ui-* variable that components.css and the shell use', () => {
  const defined = new Set([...tokens.matchAll(/(--ui-[a-z0-9-]+)\s*:/g)].map(m => m[1]));
  const used = new Set();
  for (const f of ['components.css', 'shell.css', 'styleguide.css']) for (const m of strip(read(f)).matchAll(/var\((--ui-[a-z0-9-]+)/g)) used.add(m[1]);
  const internal = new Set(['--ui-slip-n', '--ui-slip-cut']);   // derived inside .slip
  assert.deepEqual([...used].filter(n => !defined.has(n) && !internal.has(n)), [], 'used but not defined in tokens.css');
  for (const n of ['--ui-fs-xs', '--ui-fs-sm', '--ui-fs-md', '--ui-fs-lg', '--ui-fs-xl', '--ui-fs-2xl']) assert.ok(defined.has(n), `${n}: the type scale has six steps`);
});

test('TOKENS-002: colour tokens read pack roles (--theme-*), with a fallback chain; the load order is tokens, components, shell', () => {
  for (const m of tokens.matchAll(/(--ui-(?:bg|surface|surface-raised|line|line-strong|text|text-muted|accent|accent-soft|on-accent|gold|gold-soft|danger|ok|warn|focus|seal|seal-ink|ask|link)):\s*([^;]+);/g))
    assert.match(m[2], /var\(--theme-[A-Za-z]+/, `${m[1]} reads a theme role`);
  const html = fs.readFileSync(studio + 'index.html', 'utf8');
  const order = ['tokens.css', 'components.css', 'shell.css'].map(f => html.indexOf('./ui/' + f));
  assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2], 'tokens.css, components.css, shell.css in that order');
});

test('TOKENS-003: prefers-reduced-motion zeroes the durations and stops every animation and transition', () => {
  const block = tokens.slice(tokens.indexOf('@media (prefers-reduced-motion: reduce)'));
  for (const n of ['--ui-step', '--ui-dur-1', '--ui-dur-2', '--ui-dur-3', '--ui-dur-seal']) assert.match(block, new RegExp(`${n}: 0ms`));
  assert.match(block, /animation-duration: \.001ms !important/);
  assert.match(block, /transition-duration: \.001ms !important/);
  assert.doesNotMatch(tokens, /ease|cubic-bezier/, 'steps() only');
});

const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (a, pa, b) => '#' + [1, 3, 5].map(i => Math.round(pa * parseInt(a.slice(i, i + 2), 16) + (1 - pa) * parseInt(b.slice(i, i + 2), 16)).toString(16).padStart(2, '0')).join('');

function resolve(packFile) {
  const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));
  const root = packFile.slice(0, packFile.lastIndexOf('/') + 1);
  const palette = Object.fromEntries(JSON.parse(fs.readFileSync(root + pack.palette.file, 'utf8')).colors.map(c => [c.id, c.hex]));
  const T = Object.fromEntries(Object.entries(pack.ui.theme).map(([r, id]) => [r, palette[id]]));
  return {pack, palette, T};
}

// The fallback chains of tokens.css, as the CSS states them.
function tokensOf(T) {
  const bg = T.ink, raised = T.surface;
  const slip = T.panel ?? mix(T.surface, 0.55, bg);
  return {bg, slip, raised, rail: mix(slip, 0.6, bg), text: T.text, muted: T.muted, accent: T.accent, gold: T.gold, goldSoft: T.goldSoft, danger: T.danger,
    ok: T.ok ?? T.accent, warn: T.warn ?? T.gold, ask: T.ask ?? T.text, link: T.link ?? T.accent, seal: T.seal ?? T.danger, sealInk: T.sealInk ?? T.text,
    lineStrong: T.lineStrong ?? T.muted};
}

test('TOKENS-004: the pack has 18 theme roles, every one a palette id, and every text pair is 4.5:1 and every control border 3:1', () => {
  const {pack, palette, T} = resolve(studio + '../studio.project.json');
  assert.equal(Object.keys(pack.ui.theme).length, 18);
  for (const [role, id] of Object.entries(pack.ui.theme)) assert.ok(palette[id], `${role}: ${id} is a palette colour`);
  const k = tokensOf(T);
  for (const role of ['text', 'muted', 'accent', 'gold', 'goldSoft', 'danger', 'ok', 'warn', 'ask', 'link'])
    for (const surface of ['bg', 'slip', 'rail', 'raised'])
      assert.ok(contrast(k[role], k[surface]) >= 4.5, `${role} on ${surface}: ${contrast(k[role], k[surface]).toFixed(2)}`);
  assert.ok(contrast(k.sealInk, k.seal) >= 4.5, 'what is carved in the seal');
  assert.ok(contrast(k.bg, k.danger) >= 4.5 && contrast(k.bg, k.accent) >= 4.5, 'dark text on a danger or accent fill (on-accent)');
  for (const surface of ['bg', 'slip']) {
    assert.ok(contrast(k.lineStrong, k[surface]) >= 3, `control border on ${surface}`);
    assert.ok(contrast(k.gold, k[surface]) >= 3, `focus ring on ${surface}`);
  }
});

test('TOKENS-005: the 12-colour sample project, which names none of the new roles, still gets text and borders that pass', () => {
  const {T, pack} = resolve(studio + 'examples/moss-lantern/studio.project.json');
  for (const role of ['panel', 'lineStrong', 'seal', 'sealInk', 'ok', 'warn', 'ask', 'link']) assert.equal(T[role], undefined, `${role} is left out`);
  const k = tokensOf(T);
  for (const role of ['text', 'muted', 'accent', 'gold', 'goldSoft', 'ok', 'warn', 'ask', 'link'])
    for (const surface of ['bg', 'slip', 'raised']) assert.ok(contrast(k[role], k[surface]) >= 4.5, `${role} on ${surface}`);
  assert.ok(contrast(k.sealInk, k.seal) >= 4.5, 'the sample seal letters');
  assert.ok(contrast(k.lineStrong, k.bg) >= 3 && contrast(k.lineStrong, k.slip) >= 3, 'control border');
  assert.equal(pack.ui.brand.seal, undefined, 'no seal grid: the shell shows the mark letters');
});

test('TOKENS-006: the brand seal is 12 rows of 12 of "." and "#", and the schema says so', () => {
  const pack = JSON.parse(fs.readFileSync(studio + '../studio.project.json', 'utf8'));
  const seal = pack.ui.brand.seal;
  assert.equal(seal.length, 12);
  for (const row of seal) assert.match(row, /^[.#]{12}$/);
  assert.ok(seal.join('').includes('#'));
  const schema = JSON.parse(fs.readFileSync(studio + 'schemas/project.schema.json', 'utf8')).properties.ui.properties.brand.properties.seal;
  assert.equal(schema.minItems, 12); assert.equal(schema.maxItems, 12); assert.equal(schema.items.pattern, '^[.#]{12}$');
});

test('TOKENS-007: both fonts ship as woff2 with their OFL text and a record of source and hash; @font-face swaps and has system fallbacks', () => {
  for (const f of ['display-serif.woff2', 'pixel-mono.woff2', 'OFL-display-serif.txt', 'OFL-pixel-mono.txt', 'README.md']) assert.ok(fs.existsSync(ui + 'fonts/' + f), f);
  assert.equal(fs.readFileSync(ui + 'fonts/display-serif.woff2').subarray(0, 4).toString(), 'wOF2');
  assert.equal(fs.readFileSync(ui + 'fonts/pixel-mono.woff2').subarray(0, 4).toString(), 'wOF2');
  for (const f of ['OFL-display-serif.txt', 'OFL-pixel-mono.txt']) assert.match(fs.readFileSync(ui + 'fonts/' + f, 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.equal(tokens.match(/font-display: swap/g).length, 2);
  assert.match(tokens, /--ui-font-display:[^;]*serif;/);
  assert.match(tokens, /--ui-font-mono:[^;]*monospace;/);
  assert.match(read('fonts/README.md'), /[0-9a-f]{64}/);
});

test('TOKENS-008: below 900 px the rail is a drawer, one page title, one-row top bar', () => {
  const css = read('shell.css');
  const narrow = css.slice(css.indexOf('@media (max-width: 900px)'));
  assert.match(narrow, /\.rail \{[^}]*position: fixed/);
  assert.match(narrow, /\.shell\.rail-open \.rail \{[^}]*visibility: visible/);
  assert.match(narrow, /\.crumbs > :first-child \{[^}]*clip: rect\(0 0 0 0\)/, 'the bar does not repeat the page title');
  assert.doesNotMatch(css, /\.topbar \{[^}]*flex-wrap: wrap/);
  const shell = read('shell.js');
  assert.match(shell, /aria-expanded/); assert.match(shell, /'Escape'/); assert.match(shell, /rail-lock/);
  const setRail = shell.slice(shell.indexOf('function setRail'), shell.indexOf('function markActive'));
  assert.match(setRail, /querySelector\('\.column'\)\.inert = open/, 'opening makes the page behind inert, closing clears it');
  assert.ok(setRail.indexOf('.inert = open') < setRail.indexOf("$('rail-toggle')?.focus()"), 'inert is cleared before focus returns to the toggle');
  assert.match(shell, /narrow\.addEventListener\('change', \(\) => \{ if \(!narrow\.matches\) setRail\(false/, 'widening the window closes the drawer, which clears inert');
});

test('TOKENS-009: components.css is scoped to .ui-kit, so loading it changes no tab; the styleguide opts in', () => {
  const css = strip(read('components.css')).trim();
  const afterKeyframes = css.replace(/@keyframes [^{]+\{[^{}]*\{[^}]*\}[^{}]*\{[^}]*\}\s*\}/g, '').trim();
  assert.match(afterKeyframes, /^@scope \(\.ui-kit\) \{/, 'every rule is inside @scope (.ui-kit)');
  assert.ok(afterKeyframes.endsWith('}'));
  assert.match(fs.readFileSync(studio + 'index.html', 'utf8'), /components\.css/);
  assert.match(read('styleguide.html'), /<body class="ui-kit">/);
  assert.doesNotMatch(fs.readFileSync(studio + 'index.html', 'utf8'), /class="[^"]*ui-kit/, 'the app page does not opt in: tabs do, when they migrate');
});
