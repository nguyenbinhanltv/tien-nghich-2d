import fs from 'node:fs/promises';
import path from 'node:path';
import { keepCandidate } from '../../core/audio-candidates.mjs';
import { sha256 } from '../../core/fsutil.mjs';
import { ToolError } from '../registry.mjs';
import { LISTENING, analyzeRender, glance, insideProtected, renderChecked } from '../workflow/audio.mjs';
import { shown } from '../workflow/forge.mjs';
import { loadAsset } from './_shared.mjs';
import { check, envelope, sha } from '../workflow/envelope.mjs';
import { requireNotStopped } from '../workflow/stop.mjs';

export default {
  name: 'studio_audio_render',
  title: 'Render a sound from a declarative patch or score, and see what you made',
  description:
    'Make a sound effect or a music loop by sending DATA: a studio.audio.patch (one-shot: layers of oscillators and noise with envelopes, filters, FM, glides) or a studio.audio.score (a loop: instruments, a key, patterns, reverb). ' +
    'The studio\'s engine renders it deterministically (the same document always gives the same bytes; it renders twice to prove it), measures it (peak, true peak, RMS, loudness, endpoints, onset, tail, loop seam) and draws a waveform and a spectrogram. ' +
    'You get the numbers AND both pictures: that is how you inspect it. NO AGENT LISTENS, and no tool can sign a listening: a human does that in the Review tab. ' +
    'A patch must start and end at digital zero and must not clip. See studio/audio/README.md for the formats. ' +
    'keep=true stores the render as the next immutable CANDIDATE of the cue (source, WAV, pictures, measurements, provenance) and starts a review history for it; without keep it renders into scratch only. ' +
    'It never writes to the delivered audio directories. Use studio_qa_run on the cue for the audio checks, and studio_review_request to ask a human.',
  scope: 'author',
  inputSchema: {
    type: 'object',
    properties: {
      cueId: { type: 'string', maxLength: 64, description: 'The audio cue this is for (an id from studio_catalog_search source=audio, e.g. sfx_step).' },
      document: { type: 'object', description: 'A studio.audio.patch or studio.audio.score document. sampleRate may be omitted (the project\'s rate is used); seed is required.' },
      keep: { type: 'boolean', description: 'Store this render as the next candidate of the cue and start its review history. Needs a deterministic render.' },
      note: { type: 'string', maxLength: 500, description: 'With keep: what you intended, recorded with the candidate.' },
    },
    required: ['cueId', 'document'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  async handler(args, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, args.cueId);
    if (args.keep) await requireNotStopped(ws, asset, snap.pack);   // stop policy
    if (!asset.audio) throw new ToolError(`${asset.id} is not an audio cue. Audio cues come from studio_catalog_search source=audio.`);
    const { doc, kind, render, deterministic, protectedDirs } = await renderChecked(ws.root, args.document);
    const analysis = analyzeRender(render, 800, doc);
    const scratch = path.join(ws.libraryDir(), 'work', 'audio', asset.id);
    for (const target of [scratch, path.join(ws.root, asset.audio.dir)]) {
      if (insideProtected(ws.root, protectedDirs, target)) throw new ToolError(`${target} lies inside delivered audio (${protectedDirs.join(', ')}); refusing to write there.`);
    }
    await fs.rm(scratch, { recursive: true, force: true });
    await fs.mkdir(scratch, { recursive: true });
    await fs.writeFile(path.join(scratch, 'render.wav'), render.wav);
    await fs.writeFile(path.join(scratch, 'waveform.png'), analysis.images.waveform.png);
    await fs.writeFile(path.join(scratch, 'spectrogram.png'), analysis.images.spectrogram.png);

    const wavSha = sha256(render.wav), docSha = sha256(JSON.stringify(doc));
    const out = {
      cue: asset.id, kind, id: doc.id, deterministic, wavSha256: wavSha, documentSha256: docSha, bytes: render.wav.length,
      sampleRate: render.sampleRate, channels: render.channels, frames: render.frames, loop: render.loop,
      ...(render.scale ? { scale: render.scale } : {}), glance: glance(analysis.measurements), measurements: analysis.measurements, ...(analysis.pitch ? { pitch: analysis.pitch } : {}),
      images: { waveform: { width: analysis.images.waveform.width, height: analysis.images.waveform.height, axes: analysis.images.waveform.axes },
        spectrogram: { width: analysis.images.spectrogram.width, height: analysis.images.spectrogram.height, axes: analysis.images.spectrogram.axes } },
      scratch: shown(ws, scratch), listening: LISTENING,
    };
    out.qa = envelope({ method: 'rendered the document twice in memory and measured the result', 
      checks: [check('deterministic', { ok: deterministic, measured: deterministic, threshold: true }), check('clipping', { ok: (analysis.measurements.peak?.clippedSamples ?? 0) === 0, measured: analysis.measurements.peak?.clippedSamples ?? 0, threshold: 0 })],
      notProven: [{ what: 'how it sounds', why: 'no agent listens; a human signs listening in the Review tab' }],
      inputs: { document: docSha, wav: wavSha } });
    if (!deterministic) out.warning = 'Two renders of the same document gave different bytes: it cannot be kept.';
    if (args.keep) {
      if (!deterministic) throw new ToolError('Two renders of the same document gave different bytes, so it cannot be kept as a candidate.');
      const candidate = await keepCandidate(ws, { dir: asset.audio.dir, cueId: asset.id, parts: {
        source: doc, wav: render.wav, waveform: analysis.images.waveform.png, spectrogram: analysis.images.spectrogram.png, measurements: analysis.measurements,
        provenance: { agent: ctx.caller.agent, session: ctx.caller.session, at: new Date().toISOString(), tool: 'studio_audio_render (studio/audio engine)', cue: asset.id, kind,
          documentSha256: docSha, wavSha256: wavSha, deterministic, sampleRate: render.sampleRate, ...(args.note ? { note: args.note } : {}) } } });
      out.kept = { version: candidate.version, dir: candidate.dir, files: candidate.files, review: 'pending: a human signs listening and approves in the Review tab' };
    }
    out.next = out.kept ? 'studio_qa_run (from a different session, independent=true) for the audio checks, then studio_review_request.' : 'Look at the pictures and numbers. Change the document, or render again with keep=true.';
    const g = out.glance;
    return {
      content: [
        { type: 'text', text: `${kind} ${doc.id} for ${asset.id}: ${g.durationMs} ms, ${g.channels}ch ${g.sampleRate} Hz; peak ${g.peakDbfs} dBFS, true peak ${g.truePeakDbtp} dBTP, RMS ${g.rmsDbfs} dBFS, ` +
            `${g.integratedLufs === null ? `ungated ${g.ungatedLufs} LUFS` : `${g.integratedLufs} LUFS`}; starts at zero ${g.startsAtZero}, ends at zero ${g.endsAtZero}; deterministic ${deterministic}.` +
            `${out.kept ? ` Kept as candidate v${out.kept.version}.` : ''} Waveform then spectrogram below; axes are in the structured result. ${LISTENING}` },
        { type: 'image', data: analysis.images.waveform.png.toString('base64'), mimeType: 'image/png' },
        { type: 'image', data: analysis.images.spectrogram.png.toString('base64'), mimeType: 'image/png' },
      ],
      structuredContent: out,
    };
  },
};
