// Lane 5C: three interface modes (abode, ink, paper) and two densities. The pack names the colours of each mode; a pack that names none gets neutral defaults.
// WCAG here is computed, not eyeballed: text 4.5:1, a control border 3:1, and 7:1 for the body text of the high-contrast mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MODES, DENSITIES, pickMode, pickDensity, nextMode, nextDensity, modeRoles, modeLabel, applyAppearance, readChoice, writeChoice } from '../theme.mjs';
import { localize } from '../i18n.mjs';

const ui = fileURLToPath(new URL('../', import.meta.url));
const studio = fileURLToPath(new URL('../../', import.meta.url));
const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = strip(fs.readFileSync(ui + 'tokens.css', 'utf8'));

const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (a, pa, b) => '#' + [1, 3, 5].map(i => Math.round(pa * parseInt(a.slice(i, i + 2), 16) + (1 - pa) * parseInt(b.slice(i, i + 2), 16)).toString(16).padStart(2, '0')).join('');

/** Every colour token as tokens.css chooses it from the roles `T` (hex by role); a role left out falls to `fb`, the mode's neutral default. */
function tokensOf(T, fb) {
  const bg = T.ink ?? fb.ink, raised = T.surface ?? fb.surface;
  const slip = T.panel ?? mix(T.surface ?? fb.surfaceMix, 0.55, bg);
  const accent = T.accent ?? fb.accent, gold = T.gold ?? fb.gold, text = T.text ?? fb.text, danger = T.danger ?? fb.danger;
  return {bg, slip, raised, rail: mix(slip, 0.6, bg), text, muted: T.muted ?? fb.muted, accent, gold, goldSoft: T.goldSoft ?? fb.goldSoft, danger,
    ok: T.ok ?? accent, warn: T.warn ?? gold, ask: T.ask ?? text, link: T.link ?? accent,
    seal: T.seal ?? danger, sealInk: T.sealInk ?? fb.sealInk ?? text, lineStrong: T.lineStrong ?? T.muted ?? fb.lineStrong};
}

/** The --fb-* neutral defaults of a mode, read from tokens.css (the abode ones are in :root; ink and paper override them). */
function neutral(mode) {
  const read = block => Object.fromEntries([...block.matchAll(/--fb-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()), m[2]]));
  const base = read(tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('  /* ----- colour by role')));
  if (mode === 'abode') return base;
  const start = tokens.indexOf(`:root[data-theme="${mode}"]`);
  return {...base, ...read(tokens.slice(start, tokens.indexOf('}', start)))};
}

const sealFor = k => contrast(k.sealInk, k.seal);

// `legacy` is the standard the abode was held to before the modes (TOKENS-004/005): borders on the page and the slip, and `skip` names roles a pack's own palette cannot meet.
function assertPasses(name, k, {body = 4.5, legacy = false, skip = []} = {}) {
  for (const role of ['text', 'muted', 'accent', 'gold', 'goldSoft', 'danger', 'ok', 'warn', 'ask', 'link'].filter(r => !skip.includes(r)))
    for (const surface of ['bg', 'slip', 'rail', 'raised']) assert.ok(contrast(k[role], k[surface]) >= 4.5, `${name}: ${role} on ${surface} is ${contrast(k[role], k[surface]).toFixed(2)}, wants 4.5`);
  for (const surface of ['bg', 'slip', 'rail', 'raised']) assert.ok(contrast(k.text, k[surface]) >= body, `${name}: body text on ${surface} is ${contrast(k.text, k[surface]).toFixed(2)}, wants ${body}`);
  for (const surface of legacy ? ['bg', 'slip'] : ['bg', 'slip', 'raised']) {
    assert.ok(contrast(k.lineStrong, k[surface]) >= 3, `${name}: control border on ${surface} is ${contrast(k.lineStrong, k[surface]).toFixed(2)}, wants 3`);
    assert.ok(contrast(k.gold, k[surface]) >= 3, `${name}: focus ring on ${surface}`);
  }
  assert.ok(sealFor(k) >= 4.5, `${name}: what is carved in the seal is ${sealFor(k).toFixed(2)}, wants 4.5`);
  assert.ok(contrast(k.bg, k.accent) >= 4.5 && (skip.includes('danger') || contrast(k.bg, k.danger) >= 4.5), `${name}: text on an accent or danger fill`);
}

function resolvePack(file) {
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  const root = file.slice(0, file.lastIndexOf('/') + 1);
  const palette = Object.fromEntries(JSON.parse(fs.readFileSync(root + pack.palette.file, 'utf8')).colors.map(c => [c.id, c.hex]));
  const roles = obj => Object.fromEntries(Object.entries(obj ?? {}).map(([r, id]) => [r, palette[id]]));
  return {pack, palette, roles};
}

test('THEME-001: the project pack declares ink and paper; every colour is a palette id and every pair passes WCAG', () => {
  const {pack, palette, roles} = resolvePack(studio + '../studio.project.json');
  assert.deepEqual(Object.keys(pack.ui.themeModes).sort(), ['abode', 'ink', 'paper']);
  for (const mode of ['ink', 'paper']) {
    const colors = pack.ui.themeModes[mode].colors;
    assert.ok(Object.keys(colors).length >= 15, `${mode} names its roles`);
    for (const [role, id] of Object.entries(colors)) assert.ok(palette[id], `${mode}.${role}: ${id} is a palette colour`);
    assert.ok(pack.ui.themeModes[mode].name.en && pack.ui.themeModes[mode].name.vi, `${mode} has a name in both languages`);
  }
  assert.ok(pack.ui.themeModes.abode.name.vi && !pack.ui.themeModes.abode.colors, 'abode is named; its colours are ui.theme');
  assertPasses('abode', tokensOf(roles(pack.ui.theme), neutral('abode')), {legacy: true});
  assertPasses('ink', tokensOf(roles(pack.ui.themeModes.ink.colors), neutral('ink')), {body: 7});
  assertPasses('paper', tokensOf(roles(pack.ui.themeModes.paper.colors), neutral('paper')));
});

test('THEME-002: ink is a dark mode with 7:1 body text on every surface; paper is a light one with dark text', () => {
  const {pack, roles} = resolvePack(studio + '../studio.project.json');
  const ink = tokensOf(roles(pack.ui.themeModes.ink.colors), neutral('ink')), paper = tokensOf(roles(pack.ui.themeModes.paper.colors), neutral('paper'));
  assert.ok(lum(ink.bg) < 0.05 && lum(ink.text) > 0.7);
  assert.ok(lum(paper.bg) > 0.5 && lum(paper.text) < 0.05);
  assert.ok(contrast(paper.accent, paper.bg) >= 4.5 && contrast(paper.seal, paper.bg) >= 3, 'the red seal shows on paper');
  assert.ok(contrast(ink.muted, ink.raised) >= 7, 'ink: even the muted text keeps 7:1');
});

test('THEME-003: a project that declares no modes (the 12-colour sample) gets neutral defaults that pass in all three', () => {
  const {pack, roles} = resolvePack(studio + 'examples/moss-lantern/studio.project.json');
  assert.equal(pack.ui.themeModes, undefined, 'the sample names no mode');
  assertPasses('sample abode', tokensOf(roles(pack.ui.theme), neutral('abode')), {legacy: true, skip: ['danger', 'ask', 'link', 'ok', 'warn']});   // as TOKENS-005: the sample's own berry red is 3:1 on its night ground
  assertPasses('neutral ink', tokensOf({}, neutral('ink')), {body: 7});
  assertPasses('neutral paper', tokensOf({}, neutral('paper')));
  assertPasses('neutral abode', tokensOf({}, neutral('abode')), {legacy: true});
});

test('THEME-004: tokens.css reads --fb-* defaults, defines both modes and the compact density, and keeps motion as steps()', () => {
  for (const mode of ['ink', 'paper']) assert.match(tokens, new RegExp(`:root\\[data-theme="${mode}"\\]`));
  assert.match(tokens, /:root\[data-theme="paper"\][^}]*color-scheme: light/);
  assert.match(tokens, /:root\[data-theme="ink"\][^}]*color-scheme: dark/);
  assert.match(tokens, /:root\[data-density="compact"\][^}]*--ui-sp-4/);
  assert.doesNotMatch(tokens, /ease|cubic-bezier/);
  const shellCss = strip(fs.readFileSync(ui + 'shell.css', 'utf8'));
  assert.doesNotMatch(shellCss.slice(0, shellCss.indexOf('* { box-sizing')), /var\(--theme-/, 'the short names (--ink, --text ...) follow the --ui-* tokens, so they follow the mode too');
});

test('THEME-005: pickMode follows a stored choice, else the system; unknown values are ignored', () => {
  assert.equal(pickMode('ink', true), 'ink');
  assert.equal(pickMode('paper', false), 'paper');
  assert.equal(pickMode(null, true), 'paper');
  assert.equal(pickMode(null, false), 'abode');
  assert.equal(pickMode('neon', true), 'paper', 'a value that is no mode counts as no choice');
  assert.equal(pickDensity('compact'), 'compact');
  assert.equal(pickDensity('huge'), 'comfortable');
  assert.deepEqual([...MODES], ['abode', 'ink', 'paper']);
  assert.deepEqual([...DENSITIES], ['comfortable', 'compact']);
  assert.equal(nextMode('paper'), 'abode'); assert.equal(nextMode('abode'), 'ink');
  assert.equal(nextDensity('compact'), 'comfortable');
});

test('THEME-006: modeRoles, modeLabel and applyAppearance: a mode never keeps the last mode’s colours', () => {
  const project = {theme: {ink: '#101010', text: '#eeeeee', bad: 'red'}, themeModes: {paper: {name: {en: 'Paper', vi: 'Giấy'}, theme: {ink: '#f0f0f0', text: '#111111'}}, ink: {name: null, theme: {}}}};
  assert.deepEqual(modeRoles(project, 'abode'), {ink: '#101010', text: '#eeeeee'}, 'a role whose value is not hex is dropped');
  assert.deepEqual(modeRoles(project, 'paper'), {ink: '#f0f0f0', text: '#111111'});
  assert.deepEqual(modeRoles(project, 'ink'), {});
  assert.deepEqual(modeRoles({}, 'paper'), {});
  assert.equal(modeLabel(project, 'paper', 'vi', localize), 'Giấy');
  assert.equal(modeLabel(project, 'ink', 'en', localize), undefined);
  const props = new Map();
  const root = {dataset: {}, style: {setProperty: (k, v) => props.set(k, v), removeProperty: k => props.delete(k)}};
  let written = applyAppearance(root, {mode: 'abode', density: 'compact', roles: modeRoles(project, 'abode')});
  assert.equal(root.dataset.theme, 'abode'); assert.equal(root.dataset.density, 'compact');
  assert.equal(props.get('--theme-text'), '#eeeeee');
  written = applyAppearance(root, {mode: 'ink', density: 'comfortable', roles: modeRoles(project, 'ink')}, written);
  assert.equal(props.size, 0, 'ink names no colour, so nothing of the abode is left and tokens.css defaults apply');
  assert.equal(root.dataset.theme, 'ink');
  applyAppearance(root, {mode: 'nonsense', density: 'nonsense', roles: {}}, written);
  assert.equal(root.dataset.theme, 'abode'); assert.equal(root.dataset.density, 'comfortable');
});

test('THEME-007: the choice is stored through localStorage and a refusing storage does not throw', () => {
  const mem = new Map();
  const storage = {getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v)};
  assert.equal(writeChoice(storage, 'k', 'paper'), true);
  assert.equal(readChoice(storage, 'k'), 'paper');
  const refusing = {getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }};
  assert.equal(readChoice(refusing, 'k'), null);
  assert.equal(writeChoice(refusing, 'k', 'ink'), false);
});

test('THEME-008: the shell wires the menu and two palette actions; neither touches approval', () => {
  const shell = fs.readFileSync(ui + 'shell.js', 'utf8');
  assert.match(shell, /id: 'theme'/); assert.match(shell, /id: 'density'/);
  assert.match(shell, /'aria-expanded': String\(state\.themeOpen\)/);
  assert.match(shell, /matchMedia\?\.\('\(prefers-color-scheme: light\)'\)/, 'the system preference is respected until a choice is stored');
  const body = shell.slice(shell.indexOf('// ---- Mode and density'), shell.indexOf('function renderChrome'));
  assert.doesNotMatch(body, /approv|method: 'POST'|fetchJson/, 'a preference never posts anything');
});

test('THEME-009: the schema and the pack agree on ui.themeModes', () => {
  const schema = JSON.parse(fs.readFileSync(studio + 'schemas/project.schema.json', 'utf8'));
  const modes = schema.properties.ui.properties.themeModes;
  assert.deepEqual(Object.keys(modes.properties), ['abode', 'ink', 'paper']);
  assert.equal(modes.additionalProperties, false);
  assert.ok(schema.$defs.themeMode.properties.colors && schema.$defs.themeMode.properties.name);
});
