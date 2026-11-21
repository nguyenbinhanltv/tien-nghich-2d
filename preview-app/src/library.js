import { initAudio } from './pilotAudio.js';

const $ = id => document.getElementById(id);
const assets = new URL('../../assets/', import.meta.url);
const imageBase = new URL('atlases_longtime/web/', assets);
const groups = ['abode', 'interface', 'mist_archive', 'ember_delta', 'star_quarry', 'armory'];
const catalog = [];
let frames = [], index = 0, timer, artStarted = false;

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url.pathname} (HTTP ${response.status})`);
  return response.json();
}

async function loadGroup(group, definitions) {
  const base = new URL(group + '/', imageBase);
  const chunk = await json(new URL('chunk-manifest.json', base));
  const entries = new Map();
  for (const page of chunk.pages) {
    const image = new Image();
    image.src = new URL(page.image, base);
    const [atlas] = await Promise.all([json(new URL(page.json, base)), image.decode()]);
    for (const [key, data] of Object.entries(atlas.frames)) {
      const [, id, pose] = key.split('/');
      const match = /^(.*)_([0-9]+)$/.exec(pose);
      const definition = definitions.get(id);
      if (!match || !definition || definition.chunk_group !== group) continue;
      if (!entries.has(id)) entries.set(id, { id, group, readiness: chunk.readiness, clips: new Map() });
      const clips = entries.get(id).clips;
      if (!clips.has(match[1])) clips.set(match[1], []);
      clips.get(match[1]).push({ ...data, key, image, order: Number(match[2]) });
    }
  }
  for (const entry of entries.values()) {
    for (const clip of entry.clips.values()) clip.sort((a,b) => a.order - b.order);
  }
  return [...entries.values()];
}

function count(entries) {
  return entries.reduce((total, entry) => total + [...entry.clips.values()].reduce((n, clip) => n + clip.length, 0), 0);
}

async function loadArt() {
  $('catalog-status').textContent = 'Loading web atlases…';
  try {
    const manifest = await json(new URL('manifest_longtime.json', assets));
    const definitions = new Map(manifest.assets.map(row => [row.id, row]));
    const shipped = groups.filter(group => Object.hasOwn(manifest.chunks, group));
    const results = await Promise.allSettled(shipped.map(group => loadGroup(group, definitions)));
    const failures = [];
    $('group').add(new Option('All groups', ''));
    results.forEach((result, i) => {
      if (result.status === 'rejected') { failures.push(shipped[i]); return; }
      if (!result.value.length) return;
      catalog.push(...result.value);
      $('group').add(new Option(`${shipped[i]} · ${count(result.value)} frames`, shipped[i]));
    });
    catalog.sort((a,b) => a.id.localeCompare(b.id));
    $('catalog-status').textContent = `${catalog.length} delivered assets · ${count(catalog)} frames`
      + (failures.length ? ` · Unavailable groups: ${failures.join(', ')}` : '');
    filter();
  } catch (error) { $('catalog-status').textContent = error.message; filter(); }
}

function stopArt() {
  clearTimeout(timer);
  timer = undefined;
  $('play').textContent = 'Play';
}
function render() {
  const frame = frames[index];
  const canvas = $('crop');
  canvas.hidden = !frame;
  $('prev').disabled = $('next').disabled = frames.length < 2;
  $('play').disabled = frames.length < 2 || frames.some(frame => !frame.durationMs);
  if (!frame) { $('key').textContent = ''; $('frame').textContent = 'No matching frames.'; return; }
  const { x, y, w, h } = frame.frame;
  const scale = Number($('zoom').value);
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(frame.image, x,y,w,h, 0,0,canvas.width,canvas.height);
  $('key').textContent = frame.key;
  $('frame').textContent = `Frame ${index+1} / ${frames.length} · ${w}×${h} · Pivot [${frame.pivotPx.join(', ')}] · ${frame.durationMs ? frame.durationMs+' ms' : 'Static (0 ms)'}`;
}
function selectClip() {
  stopArt(); index = 0;
  frames = catalog.find(entry => entry.id === $('asset').value)?.clips.get($('clip').value) || [];
  render();
}
function selectAsset() {
  const entry = catalog.find(row => row.id === $('asset').value);
  $('asset-name').textContent = entry ? `${entry.id} · ${entry.readiness}` : 'Frame preview';
  $('clip').replaceChildren();
  for (const clip of entry?.clips.keys() || []) $('clip').add(new Option(clip,clip));
  selectClip();
}
function filter() {
  const query = $('filter').value.trim().toLowerCase();
  const group = $('group').value;
  const matches = catalog.filter(entry => (!group || entry.group === group) && entry.id.includes(query));
  $('asset').replaceChildren(...matches.map(entry => new Option(entry.id, entry.id)));
  $('asset').selectedIndex = matches.length ? 0 : -1;
  selectAsset();
}
function step(by) { index = (index + by + frames.length) % frames.length; render(); }
function schedule() { timer = setTimeout(() => { step(1); schedule(); }, frames[index].durationMs); }
$('play').onclick = () => {
  if (timer !== undefined) return stopArt();
  $('play').textContent = 'Pause'; schedule();
};
$('prev').onclick = () => { stopArt(); step(-1); };
$('next').onclick = () => { stopArt(); step(1); };
$('zoom').onchange = render;
$('group').onchange = $('filter').oninput = filter;
$('asset').onchange = selectAsset;
$('clip').onchange = selectClip;
const audio = initAudio(new URL('audio/packs/pilot_v1/', assets), json);

function navigate() {
  const current = location.hash === '#audio' ? 'audio' : 'art';
  $('audio').hidden = current !== 'audio';
  $('art').hidden = current !== 'art';
  for (const link of document.querySelectorAll('nav a')) {
    if (link.hash === '#' + current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (current === 'audio') { stopArt(); audio.load(); }
  else { audio.stop(); if (!artStarted) { artStarted = true; loadArt(); } }
}
window.addEventListener('hashchange', navigate);
window.addEventListener('pagehide', () => { stopArt(); audio.stop(); });
navigate();
