// The Pictures view: waveform and spectrogram from studio/audio, with the legend of what the lines mean.
import { h } from './dom.mjs';

export async function renderPictures(app, el, detail, entry, current) {
  const {ctx} = app, base = `/api/tabs/${ctx.tab}/image?id=${encodeURIComponent(entry.id)}&width=1000`;
  const figure = (kind, alt) => h('figure', 'au-figure', h('figcaption', '', ctx.t('pictures.' + kind)), h('div', 'au-figure-scroll', h('img', {src: `${base}&kind=${kind}`, alt, loading: 'lazy'})));
  const legend = h('ul', 'au-legend',
    ...(entry.kind === 'bed' ? [['loop', ctx.t('pictures.legendLoop')]] : [['onset', ctx.t('pictures.legendOnset')], ['tail', ctx.t('pictures.legendTail')]])
      .map(([k, text]) => h('li', '', h('span', 'swatch ' + k), text)),
    h('li', '', h('span', 'swatch peak'), ctx.t('pictures.legendPeak')), h('li', '', h('span', 'swatch rms'), ctx.t('pictures.legendRms')));
  el.replaceChildren(h('p', 'muted', ctx.t('pictures.help')), legend,
    figure('waveform', ctx.t('pictures.waveformAlt', {id: entry.id})), figure('spectrogram', ctx.t('pictures.spectrogramAlt', {id: entry.id})), h('p', {class: 'muted au-axes', 'data-axes': ''}));
  try {
    const axes = await ctx.tabApi(`image?id=${encodeURIComponent(entry.id)}&kind=spectrogram&width=1000&axes=1`);
    if (current()) el.querySelector('[data-axes]').textContent = ctx.t('pictures.axes', {framesPerPx: Math.round(axes.axes.framesPerPx), min: axes.axes.minHz, max: Math.round(axes.axes.maxHz), lo: axes.axes.dbRange[0], hi: axes.axes.dbRange[1]});
  } catch (error) { if (error.name === 'AbortError') return; }
}
