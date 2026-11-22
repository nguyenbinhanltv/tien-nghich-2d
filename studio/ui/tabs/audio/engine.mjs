// WebAudio playback for the Audio tab. Nothing plays, and no AudioContext exists, until a user gesture calls
// `engine.play*`. One bus: source -> level match gain -> master volume -> (optional mono fold-down) -> output.
// Decoded buffers are cached per URL and content version (the file's SHA-256), so a re-rendered master is never played from a stale buffer; a context is recreated only when the project's sample rate changes.

export function createEngine({onChange = () => {}} = {}) {
  let ctx = null, rate = null, master = null, mono = null, monoOn = false, volume = 0.8;
  const buffers = new Map();
  const live = new Set();
  const heard = new Map(); // label -> seconds played this session
  const heardOk = new Set(); // labels played for most of their length (or 1.5 s) at least once

  function ensure(sampleRate) {
    if (ctx && rate !== sampleRate) { stopAll(); ctx.close(); ctx = null; buffers.clear(); }
    if (!ctx) {
      ctx = new AudioContext({sampleRate});
      rate = sampleRate;
      master = new GainNode(ctx, {gain: volume});
      mono = new GainNode(ctx, {channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers'});
      route();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function route() {
    master.disconnect(); mono.disconnect();
    if (monoOn) { master.connect(mono); mono.connect(ctx.destination); } else master.connect(ctx.destination);
  }

  /** Decode `url`. `version` is the content hash of what the URL serves now; a changed hash is a new cache entry. */
  async function load(url, sampleRate, version) {
    ensure(sampleRate);
    const key = version ? `${url}#${version}` : url;
    if (!buffers.has(key)) {
      buffers.set(key, fetch(url, {cache: 'no-store'}).then(r => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.arrayBuffer(); })
        .then(bytes => ctx.decodeAudioData(bytes)).catch(error => { buffers.delete(key); throw error; }));
    }
    return buffers.get(key);
  }

  /**
   * Start a buffer. opts: {gain, offsetFrames, endFrames, loop: {start, end} (frames), repeats, label, onEnd}.
   * With `loop` and `repeats` it plays the loop region that many times and stops; with `loop` alone it runs until stopped.
   */
  function play(buffer, opts = {}) {
    const c = ensure(buffer.sampleRate), sr = buffer.sampleRate;
    const source = new AudioBufferSourceNode(c, {buffer});
    const gain = new GainNode(c, {gain: opts.gain ?? 1});
    source.connect(gain); gain.connect(master);
    const offset = (opts.offsetFrames ?? opts.loop?.start ?? 0) / sr;
    const t0 = c.currentTime + 0.03;
    let duration; // seconds to play; undefined means until stopped or the end of the buffer
    if (opts.loop) {
      source.loop = true; source.loopStart = opts.loop.start / sr; source.loopEnd = opts.loop.end / sr;
      const from = opts.offsetFrames ?? opts.loop.start, len = opts.loop.end - opts.loop.start;
      if (opts.repeats) duration = (opts.loop.end - from + (opts.repeats - 1) * len) / sr;
      if (opts.maxSeconds) duration = Math.min(duration ?? Infinity, opts.maxSeconds);
    } else if (opts.endFrames !== undefined) duration = Math.max(0.005, (opts.endFrames - (opts.offsetFrames ?? 0)) / sr);
    source.start(t0, offset);
    if (duration !== undefined) source.stop(t0 + duration);
    const handle = {label: opts.label ?? '', t0, offset, sr, loop: opts.loop ?? null, source, gain, stopped: false,
      stop() { if (handle.stopped) return; handle.stopped = true; try { source.stop(); } catch { /* already ended */ } },
      position() {
        const elapsed = Math.max(0, c.currentTime - t0);
        const start = handle.offset * sr;
        if (!handle.loop) return start + elapsed * sr;
        const len = handle.loop.end - handle.loop.start, pos = start + elapsed * sr;
        return pos < handle.loop.end ? pos : handle.loop.start + ((pos - handle.loop.start) % len);
      }};
    live.add(handle);
    source.onended = () => {
      live.delete(handle);
      const played = Math.max(0, Math.min(c.currentTime - t0, duration ?? buffer.duration));
      const total = duration ?? buffer.duration;
      if (handle.label) {
        heard.set(handle.label, (heard.get(handle.label) ?? 0) + played);
        if (played >= Math.min(1.5, 0.8 * total)) heardOk.add(handle.label);
      }
      gain.disconnect();
      opts.onEnd?.(handle);
      onChange();
    };
    onChange();
    return handle;
  }

  function stopAll() { for (const h of [...live]) h.stop(); }

  return {
    load, play, stopAll,
    get playing() { return live.size > 0; },
    get handles() { return [...live]; },
    get mono() { return monoOn; },
    setMono(on) { monoOn = on; if (ctx) route(); onChange(); },
    get volume() { return volume; },
    setVolume(v) { volume = v; if (master) master.gain.value = v; },
    heard: () => new Map(heard),
    /** Labels played for most of their length (short effects) or at least 1.5 s (beds), in this page session. */
    heardLabels: () => [...heardOk],
    get sampleRate() { return rate; },
    /** What the browser can decode, so a missing AAC decoder reads as "this browser", not as a broken pack. */
    canPlay(type) { const a = document.createElement('audio'); return a.canPlayType(type) !== ''; },
    dispose() { stopAll(); if (ctx) ctx.close(); ctx = null; buffers.clear(); }
  };
}
