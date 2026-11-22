import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

class FakeElement {
  constructor(tag) { this.tag = tag; this.className = ''; this.attrs = {}; this.children = []; }
  setAttribute(name, value) { this.attrs[name] = value; }
  append(...kids) { this.children.push(...kids); }
}
globalThis.document = {createElement: tag => new FakeElement(tag)};
const { heroWords, sceneOptions, readSceneChoice, saveSceneChoice, SCENE_KEY } = await import('./scene.mjs');

const ctx = project => ({project, label: v => v.en, t: (key, vars) => key + (vars ? JSON.stringify(vars) : '')});

test('a project with ui.voice speaks in its own words', () => {
  const words = heroWords(ctx({name: 'P', voice: {name: {en: 'Abode'}, greeting: {en: 'Hello'}, pipeline: {en: 'Veins'}}}));
  assert.deepEqual(words, {title: 'Abode', greeting: 'Hello', pipeline: 'Veins'});
});

test('a project without voice gets neutral words', () => {
  const words = heroWords(ctx({name: 'Moss', voice: null}));
  assert.equal(words.title, 'title');
  assert.equal(words.greeting, 'subtitle{"project":"Moss"}');
  assert.equal(words.pipeline, 'pipeline.title');
});

test('the scene is neutral unless the pack declares otherwise', () => {
  assert.deepEqual(sceneOptions(null), {gate: 'none', lanterns: false});
  assert.deepEqual(sceneOptions({name: {en: 'x'}}), {gate: 'none', lanterns: false});
  assert.deepEqual(sceneOptions({scene: {gate: 'pailou', lanterns: true}}), {gate: 'pailou', lanterns: true});
  assert.deepEqual(sceneOptions({scene: {gate: 'torii', lanterns: 'yes'}}), {gate: 'none', lanterns: false}, 'unknown values fall back to neutral');
});

test('the scene choice is remembered and defaults to on; a broken store does not throw', () => {
  const store = new Map();
  const storage = {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)};
  assert.equal(readSceneChoice(storage), true);
  saveSceneChoice(false, storage);
  assert.equal(store.get(SCENE_KEY), 'off');
  assert.equal(readSceneChoice(storage), false);
  saveSceneChoice(true, storage);
  assert.equal(readSceneChoice(storage), true);
  const broken = {getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }};
  assert.equal(readSceneChoice(broken), true);
  assert.doesNotThrow(() => saveSceneChoice(false, broken));
});

test('the pack and its schema declare ui.voice; the example project needs none', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('../../../schemas/project.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(schema.properties.ui.properties.voice.properties), ['name', 'greeting', 'pipeline', 'scene']);
  assert.ok(!schema.properties.ui.required.includes('voice'));
});

test('the stylesheet draws the gate only from the pack-declared pailou pieces, with no hard-coded colours', () => {
  const css = fs.readFileSync(new URL('overview.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.match(css, /\.pl\.roof/);
});

test('motion in the overview stylesheet is stepped and switched off for reduced motion', () => {
  const css = fs.readFileSync(new URL('overview.css', import.meta.url), 'utf8');
  for (const m of css.matchAll(/animation:[^;]*;/g)) assert.match(m[0], /steps\(|none/, m[0]);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*animation: none/);
});
