// The Listen view: pick the version (master, Ogg, AAC), play it at matched level, loop a bed three times across its seam,
// play an effect solo or over a bed, fold to mono, and run a blind A/B. Playback only starts from a click here.
import { h, button, select, humanize, put } from './dom.mjs';
import { levelGain, dbOf, formatFrames, codecs, playLabel } from './model.mjs';
import { renderBlind } from './ab.mjs';

export const apiBase = ctx => '/api/tabs/' + ctx.tab + '/';
const q = encodeURIComponent;

/** Where a version of a cue lives and which frames to play: {url, sampleRate, loop | region, frames, note}. */
export function versionOf(ctx, detail, codec, packId) {
  const base = apiBase(ctx);
  if (codec === 'master') {
    const m = detail.masterInfo;
    if (!m) return null;
    return {codec, version: m.sha256, url: base + 'master?id=' + q(detail.id), sampleRate: m.sampleRate, frames: m.frames, loop: detail.kind === 'bed' ? detail.loop : null, region: detail.kind === 'effect' ? {start: 0, end: m.frames} : null};
  }
  const pack = detail.packDetails.find(p => p.id === packId) ?? detail.packDetails[0];
  if (!pack) return null;
  if (detail.kind === 'bed') {
    const c = pack.bed?.codecs?.[codec];
    if (!c) return null;
    return {codec, pack: pack.id, version: c.sha256 ?? `${pack.id}@${pack.revision}`, url: base + `packfile?pack=${q(pack.id)}&name=${q(c.file)}`, sampleRate: pack.bed.sampleRate, frames: c.decodedFrames, loop: c.loop, info: c};
  }
  const c = pack.sfx?.codecs?.[codec], mark = c?.markers?.find(m => m.id === detail.id);
  if (!c || !mark) return null;
  return {codec, pack: pack.id, version: c.sha256 ?? `${pack.id}@${pack.revision}`, url: base + `packfile?pack=${q(pack.id)}&name=${q(c.file)}`, sampleRate: pack.sfx.sampleRate, frames: c.decodedFrames,
    region: {start: mark.sprite_start, end: mark.sprite_end_exclusive}, info: c};
}

const mimeFor = {ogg: 'audio/ogg; codecs="vorbis"', m4a: 'audio/mp4; codecs="mp4a.40.2"'};

export async function renderListen(app, el, detail, entry, current) {
  const {ctx, state, engine} = app;
  const packId = state.pack ?? detail.packDetails[0]?.id ?? null;
  const codec = codecs.includes(state.codec) ? state.codec : 'master';
  const version = versionOf(ctx, detail, codec, packId);
  const tag = c => playLabel(entry.id, entry.masterSha, c);
  const isMain = x => x.label.startsWith(`play:${entry.id}@`) && !x.label.endsWith(':ab') && !x.label.endsWith(':sprite');
  const status = h('p', {class: 'au-status', role: 'status'});
  const say = text => { status.textContent = text; ctx.announce?.(text); };
  const measureP = app.measure(entry.id).catch(() => null);
  let measured = null;

  // ---- version and level controls
  const available = c => c === 'master' ? Boolean(detail.masterInfo) : Boolean(versionOf(ctx, detail, c, packId));
  const versions = h('div', {class: 'au-versions', role: 'group', 'aria-label': ctx.t('listen.version')},
    ...codecs.map(c => {
      const ok = available(c), canDecode = c === 'master' || engine.canPlay(mimeFor[c]);
      const b = h('a', {class: 'au-ver' + (c === codec ? ' on' : '') + (ok ? '' : ' off'), href: ok ? ctx.href(app.route({codec: c})) : false, 'aria-disabled': ok ? false : 'true',
        title: !ok ? ctx.t('listen.noVersion') : !canDecode ? ctx.t('listen.noDecoder') : false}, ctx.t('codec.' + c), canDecode ? '' : ' ⚠');
      return b;
    }));
  const packSelect = detail.packDetails.length > 1 ? select(ctx.t('listen.pack'), packId, detail.packDetails.map(p => [p.id, p.id]), v => app.go({pack: v})) : null;
  const matched = h('input', {type: 'checkbox', id: 'au-match', checked: true});
  const mono = h('input', {type: 'checkbox', id: 'au-mono', checked: engine.mono || false});
  mono.addEventListener('change', () => { engine.setMono(mono.checked); });
  const vol = h('input', {type: 'range', min: 0, max: 1, step: 0.01, value: engine.volume, 'aria-label': ctx.t('listen.volume')});
  vol.addEventListener('input', () => engine.setVolume(Number(vol.value)));
  const gainLabel = h('span', 'muted au-gain');
  const controls = h('div', 'au-controls',
    h('div', 'au-controls-row', versions, packSelect),
    h('div', 'au-controls-row',
      h('label', 'check', matched, h('span', '', ctx.t('listen.matched'))), h('label', 'check', mono, h('span', '', ctx.t('listen.mono'))),
      h('label', 'field inline', h('span', '', ctx.t('listen.volume')), vol), gainLabel));
  const transport = h('div', 'au-transport');
  const wave = h('div', 'au-wave');
  put(el, controls, transport, status, wave);

  // ---- level match
  async function gainFor() {
    if (!matched.checked) return 1;
    measured ??= await measureP;
    return levelGain(measured?.measurements);
  }
  measureP.then(m => { measured = m; if (current()) gainLabel.textContent = ctx.t('listen.gain', {db: dbOf(levelGain(m?.measurements))}); });

  // ---- waveform with a playhead
  const frames = detail.masterInfo?.frames ?? 1;
  const img = h('img', {class: 'au-wave-img', alt: ctx.t('pictures.waveformAlt', {id: entry.id}), src: apiBase(ctx) + `image?id=${q(entry.id)}&kind=waveform&width=1000`});
  const head = h('div', {class: 'au-playhead', hidden: true});
  put(wave, h('div', 'au-wave-wrap', img, head),
    h('p', 'muted au-wave-note', ctx.t('listen.waveNote')));
  const delta = version?.loop && detail.loop ? version.loop.start - detail.loop.start : 0;
  let raf = 0;
  function frameLoop() {
    cancelAnimationFrame(raf);
    const handles = engine.handles.filter(isMain);
    if (!handles.length || !current()) { head.hidden = true; return; }
    const masterFrame = handles[0].position() - (handles[0].delta ?? 0);
    const plotLeft = 54 / (img.naturalWidth || 1062), plotW = 1000 / (img.naturalWidth || 1062);
    head.hidden = false;
    head.style.left = `${(plotLeft + plotW * Math.min(1, Math.max(0, masterFrame / frames))) * 100}%`;
    raf = requestAnimationFrame(frameLoop);
  }
  app.onCleanup(() => { cancelAnimationFrame(raf); engine.stopAll(); });
  const previousOnEngine = app.onEngine;
  app.onEngine = () => { previousOnEngine?.(); if (current()) frameLoop(); };

  // ---- playing
  async function bufferFor(v) {
    try { return await engine.load(v.url, v.sampleRate, v.version); }
    catch (error) { say(ctx.t('listen.decodeFailed', {codec: ctx.t('codec.' + v.codec), message: error.message})); return null; }
  }
  function checkDecode(v, buffer) {
    if (v.info?.decodedFrames !== undefined && buffer.length !== v.info.decodedFrames)
      return ctx.t('listen.lengthDiffers', {browser: buffer.length.toLocaleString('en-US'), pack: v.info.decodedFrames.toLocaleString('en-US')});
    return '';
  }
  async function playMain(mode) {
    const v = versionOf(ctx, detail, codec, packId);
    if (!v) return say(ctx.t('listen.noVersion'));
    say(ctx.t('listen.loading'));
    const [buffer, gain] = await Promise.all([bufferFor(v), gainFor()]);
    if (!buffer) return;
    engine.handles.filter(isMain).forEach(x => x.stop());
    const label = tag(codec);
    let handle;
    if (entry.kind === 'bed') {
      const loop = v.loop, seamFrames = Math.round(4 * buffer.sampleRate);
      const opts = {gain, loop, label};
      if (mode === 'x3') Object.assign(opts, {repeats: 3});
      if (mode === 'seam') Object.assign(opts, {offsetFrames: Math.max(loop.start, loop.end - seamFrames), maxSeconds: 8});
      handle = engine.play(buffer, opts);
    } else {
      handle = engine.play(buffer, {gain: (bedHandle ? 1 : gain), offsetFrames: v.region.start, endFrames: v.region.end, label});
    }
    handle.delta = delta;
    say([mode === 'x3' ? ctx.t('listen.playingX3') : mode === 'seam' ? ctx.t('listen.playingSeam') : ctx.t('listen.playing', {codec: ctx.t('codec.' + codec)}), checkDecode(v, buffer)].filter(Boolean).join(' '));
    frameLoop();
  }

  // Switch version while playing at the same position (the decoded-frame map shifts a codec's loop by its lead-in).
  async function switchTo(next) {
    const playing = engine.handles.find(isMain);
    if (!playing) return app.go({codec: next});
    const masterFrame = playing.position() - (playing.delta ?? 0);
    const v = versionOf(ctx, detail, next, packId);
    if (!v) return say(ctx.t('listen.noVersion'));
    const [buffer, gain] = await Promise.all([bufferFor(v), gainFor()]);
    if (!buffer) return;
    playing.stop();
    const d = v.loop && detail.loop ? v.loop.start - detail.loop.start : 0;
    const h2 = engine.play(buffer, entry.kind === 'bed' ? {gain, loop: v.loop, offsetFrames: Math.min(v.loop.end - 1, Math.max(v.loop.start, masterFrame + d)), label: tag(next)}
      : {gain, offsetFrames: v.region.start, endFrames: v.region.end, label: tag(next)});
    h2.delta = d;
    app.go({codec: next}, {replace: true});
    frameLoop();
  }
  versions.querySelectorAll('a.au-ver:not(.off)').forEach((a, i) => a.addEventListener('click', event => {
    if (!engine.handles.some(isMain)) return;
    event.preventDefault();
    switchTo(codecs.filter(c => available(c))[i]);
  }));

  let bedHandle = null;
  const stop = button(ctx.t('listen.stop'), () => { engine.stopAll(); bedHandle = null; say(ctx.t('listen.stopped')); }, {class: 'plain danger'});
  if (entry.kind === 'bed') {
    put(transport, button(ctx.t('listen.play'), () => playMain('loop'), {class: 'plain primary'}), button(ctx.t('listen.x3'), () => playMain('x3'), {title: ctx.t('listen.x3Hint')}),
      button(ctx.t('listen.seam'), () => playMain('seam'), {title: ctx.t('listen.seamHint')}), stop);
  } else {
    const beds = detail.beds, bedId = state.bed && beds.some(b => b.id === state.bed) ? state.bed : beds[0]?.id;
    const bedPick = beds.length ? select(ctx.t('listen.bed'), bedId, beds.map(b => [b.id, b.id]), v => app.go({bed: v}, {replace: true})) : null;
    const startBed = async () => {
      const bed = await app.cue(bedId).catch(() => null);
      const v = bed && versionOf(ctx, bed, 'master');
      if (!v) return say(ctx.t('listen.noBed'));
      say(ctx.t('listen.loading'));
      const buffer = await bufferFor(v);
      if (!buffer) return;
      bedHandle?.stop();
      bedHandle = engine.play(buffer, {gain: 1, loop: v.loop, label: 'bed:' + bedId});
      say(ctx.t('listen.bedPlaying', {bed: bedId}));
    };
    const trigger = async () => { await playMain('solo'); };
    put(transport, button(ctx.t('listen.solo'), async () => { bedHandle?.stop(); bedHandle = null; await playMain('solo'); }, {class: 'plain primary'}),
      bedPick, button(ctx.t('listen.bedStart'), startBed), button(ctx.t('listen.trigger'), trigger, {title: ctx.t('listen.triggerHint')}), stop);
  }

  await renderBlind(app, el, detail, entry, current, {say, gainFor});
}
