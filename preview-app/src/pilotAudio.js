export function initAudio(base, json) {
  const $ = id => document.getElementById(id);
  let context, gain, source, request = 0, pack, loading;
  const buffers = new Map();
  function status(text) { $('audio-status').textContent = text; }
  function stop() {
    request++;
    if (source) {
      source.onended = null;
      source.stop();
      source.disconnect();
      source = null;
    }
    $('stop').disabled = true;
    if (pack) status('Ready to listen.');
  }
  async function decode(file) {
    const response = await fetch(new URL(file, base));
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${file}`);
    return context.decodeAudioData(await response.arrayBuffer());
  }
  async function play(kind, id) {
    stop();
    const token = request;
    const codec = $('codec').value;
    const track = pack[kind];
    const encoded = track.codecs[codec];
    $('stop').disabled = false;
    status(`Loading ${id}…`);
    try {
      if (!context) {
        context = new AudioContext();
        gain = context.createGain();
        gain.gain.value = Number($('volume').value)/100;
        gain.connect(context.destination);
      }
      await context.resume();
      if (token !== request) return;
      if (!buffers.has(encoded.file)) {
        buffers.set(encoded.file, decode(encoded.file).catch(error => { buffers.delete(encoded.file); throw error; }));
      }
      const buffer = await buffers.get(encoded.file);
      if (token !== request) return;
      const music = kind === 'bgm';
      const marker = music ? encoded.decoded_loop_frames : encoded.decoded_markers.find(row => row.id === id).decoded;
      const start = music ? marker.loopStart : marker.sprite_start;
      const end = music ? marker.loopEnd : marker.sprite_end_exclusive;
      // decodeAudioData resamples to the context rate. Round each source boundary
      // independently to an actual decoded frame before scheduling in seconds.
      const at = frame => Math.round(frame * buffer.sampleRate / track.sample_rate_hz);
      const first = at(start), last = at(end);
      if (!(first >= 0 && first < last && last <= buffer.length)) throw new Error('Published markers exceed the decoded audio.');
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.onended = () => { if (token === request) { source.disconnect(); source = null; $('stop').disabled = true; status('Ready to listen.'); } };
      const from = first / buffer.sampleRate, to = last / buffer.sampleRate;
      if (music) {
        source.loop = true; source.loopStart = from; source.loopEnd = to;
        source.start(0, from);
      } else source.start(0, from, to - from);
      status(`${music ? 'Looping' : 'Playing'} ${id} · ${codec.toUpperCase()} · decoded frames [${first}, ${last}) at ${buffer.sampleRate} Hz`);
    } catch (error) {
      if (token === request) { stop(); status(`Cannot audition ${id}. ${error.message} Try the other codec.`); }
    }
  }
  function button(kind, id) {
    const el = document.createElement('button');
    el.textContent = id;
    el.onclick = () => play(kind, id);
    return el;
  }
  async function load() {
    if (loading || pack) return;
    loading = true; status('Loading pilot pack…');
    try {
      const data = await json(new URL('pack.json', base));
      $('music').replaceChildren(button('bgm', data.bgm.id));
      $('effects').replaceChildren(...data.sfx.cues.map(cue => button('sfx', cue.id)));
      pack = data; status('Ready to listen.');
    } catch (error) { status(`Pilot pack unavailable. ${error.message}`); }
    finally { loading = false; }
  }
  $('codec').onchange = $('stop').onclick = stop;
  $('volume').oninput = () => { if (gain) gain.gain.value = Number($('volume').value)/100; };
  return { load, stop };
}
