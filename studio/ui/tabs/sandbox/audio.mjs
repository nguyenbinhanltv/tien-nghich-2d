// The Sandbox's sound: no AudioContext exists until `unlock()` runs inside a click or key press, so nothing plays and nothing
// is created before a person acts. Cues are fetched through the Audio tab's read-only master route and decoded here.
export function createMixer({masterUrl}) {
  let ctx = null, bed = null;
  const buffers = new Map();
  const live = new Set();
  const state = {played: [], failed: []};

  function unlock() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  async function decode(id) {
    if (!buffers.has(id)) buffers.set(id, fetch(masterUrl(id)).then(r => { if (!r.ok) throw new Error(`${r.status} ${id}`); return r.arrayBuffer(); })
      .then(bytes => unlock().decodeAudioData(bytes)).catch(error => { buffers.delete(id); throw error; }));
    return buffers.get(id);
  }
  /** Play a cue once. Call from a user gesture. Resolves true when it started. */
  async function cue(id) {
    unlock();
    try {
      const buffer = await decode(id);
      const source = new AudioBufferSourceNode(ctx, {buffer});
      source.connect(ctx.destination);
      live.add(source); source.onended = () => live.delete(source);
      source.start();
      state.played.push(id);
      return true;
    } catch { state.failed.push(id); return false; }
  }
  /** Start or stop the bed (a whole-master loop; the loop points of the pack are not read here). */
  async function toggleBed(id) {
    if (bed) { try { bed.stop(); } catch { /* ended */ } bed = null; return false; }
    unlock();
    try {
      const buffer = await decode(id);
      bed = new AudioBufferSourceNode(ctx, {buffer, loop: true});
      const gain = new GainNode(ctx, {gain: 0.5});
      bed.connect(gain); gain.connect(ctx.destination);
      bed.start();
      return true;
    } catch { state.failed.push(id); bed = null; return false; }
  }
  function stopAll() { for (const s of live) try { s.stop(); } catch { /* ended */ } live.clear(); if (bed) { try { bed.stop(); } catch { /* ended */ } bed = null; } }
  return {unlock, cue, toggleBed, stopAll, state, get started() { return ctx !== null; }, get bedOn() { return bed !== null; },
    dispose() { stopAll(); if (ctx) ctx.close(); ctx = null; buffers.clear(); }};
}
