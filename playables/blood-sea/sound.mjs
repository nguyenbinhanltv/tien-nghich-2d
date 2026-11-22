// Original Blood Sea cue score. Each note gives onset, pitch in Hz, and decay in seconds.
const cues = {
  dodge: [[0, 698, .11]],
  evade: [[0, 523, .14], [.075, 784, .17]],
  counterHit: [[0, 196, .19], [.025, 587, .24]],
  hurt: [[0, 131, .18], [.06, 98, .15]],
  awaken: [[0, 110, .32], [.16, 147, .32]],
  releasing: [[0, 392, .24], [.12, 523, .26], [.24, 784, .38]],
  falling: [[0, 196, .25], [.18, 98, .35]]
};

export function ring(context, output, cue) {
  for (const [delay, pitch, decay] of cues[cue]) {
    const start = context.currentTime + delay;
    // The inharmonic upper partial decays first, like the edge of a struck bronze bell.
    for (const [ratio, strength, sustain] of [[1, .14, decay], [2.72, .035, decay * .48]]) {
      const tone = context.createOscillator(), envelope = context.createGain();
      tone.frequency.value = pitch * ratio;
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(strength, start + .006);
      envelope.gain.exponentialRampToValueAtTime(.0001, start + sustain);
      tone.connect(envelope).connect(output);
      tone.onended = () => { tone.disconnect(); envelope.disconnect(); };
      tone.start(start);
      tone.stop(start + sustain + .005);
    }
  }
}

export function courtSound(button) {
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  let context, output;
  const heard = new WeakSet();
  function silence() {
    if (!output) return;
    const previous = output;
    previous.gain.setTargetAtTime(0, context.currentTime, .006);
    setTimeout(() => previous.disconnect(), 40);
    output = null;
  }
  if (!Audio) button.hidden = true;
  button.onclick = async event => {
    if (event.detail > 0) button.blur();
    button.disabled = true;
    try {
      if (output) silence();
      else {
        context ??= new Audio();
        await context.resume();
        output = context.createGain();
        output.connect(context.destination);
        ring(context, output, 'dodge');
      }
    } catch {
      silence();
      button.textContent = 'Sound unavailable';
      button.setAttribute('aria-pressed', 'false');
      return;
    }
    button.setAttribute('aria-pressed', String(!!output));
    button.textContent = output ? 'Sound on' : 'Sound off';
    button.disabled = false;
  };
  function playOnce(event, cue) {
    if (heard.has(event)) return;
    heard.add(event);
    if (output && !document.hidden && context.state === 'running') ring(context, output, cue);
  }
  return function updateSound(state, dodgeCue) {
    if (state.mode === 'releasing' || state.mode === 'falling') {
      playOnce(state, state.mode);
    } else if (state.mode === 'playing') {
      if (dodgeCue) playOnce(state.hazard, 'dodge');
      for (const fx of state.fx) {
        if (Object.hasOwn(cues, fx.kind)) playOnce(fx, fx.kind);
      }
    }
  };
}
