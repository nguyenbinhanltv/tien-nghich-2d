import fs from 'node:fs/promises';
import { latestVersion, readVersion } from '../../core/audio-candidates.mjs';
import { containedPath } from '../../core/fsutil.mjs';
import { readInside } from '../../core/files.mjs';
import { ToolError } from '../registry.mjs';
import { LISTENING, analyzeRender, glance, renderChecked } from '../workflow/audio.mjs';
import { analyze } from '../../audio/index.mjs';
import { loadAsset } from './_shared.mjs';

const MAX_WAV = 25 * 1024 * 1024;

// The exactly-one rule is checked in the handler and stated in every property description: a top-level oneOf in an input
// schema is rejected by some clients' tool APIs, so it is deliberately not used.
export default {
  name: 'studio_audio_analyze',
  title: 'Measure and look at a sound: waveform, spectrogram and numbers',
  description:
    'See a sound you cannot hear: peak, true peak, RMS, BS.1770 loudness, endpoints, onset, tail, the loop seam and the spectrum as numbers, plus a waveform and a spectrogram picture whose axes are returned so you can read times and frequencies off them. ' +
    'Give EXACTLY ONE of file, cueId or document (two or none is refused): a WAV file in the project (a delivered master, for comparison: read-only), a kept candidate of a cue (cueId, optional version), or a document (rendered in memory, nothing stored). ' +
    'A document names its own cue in its id and needs no cueId; to analyse what you kept, pass cueId alone. ' +
    'For a loop give loop {start, end} in frames to measure its seam. Read-only. No agent listens and no tool can sign a listening: that is a human step in the Review tab.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', maxLength: 300, description: 'One of file, cueId, document (exactly one). Project-relative path to a WAV file (PCM16/24/32 or float32).' },
      cueId: { type: 'string', maxLength: 64, description: 'One of file, cueId, document (exactly one). An audio cue with a kept candidate; analyses its render.wav. Do not combine with document.' },
      version: { type: 'integer', minimum: 1, description: 'With cueId: which candidate (default: the newest).' },
      document: { type: 'object', description: 'One of file, cueId, document (exactly one). A patch or score document to render and analyse without keeping anything; its own id names the cue, so no cueId.' },
      loop: { type: 'object', properties: { start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 1 } }, required: ['start', 'end'], additionalProperties: false, description: 'Loop points in frames, to measure the seam.' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(args, ctx) {
    const given = ['file', 'cueId', 'document'].filter((k) => args[k] !== undefined);
    if (given.length !== 1) throw new ToolError(`Give exactly one of file, cueId or document${given.length ? ` (you gave ${given.join(' and ')}: a document names its own cue, so drop cueId)` : ''}.`);
    const ws = ctx.project.workspace;
    let analysis, label, extra = {};
    try {
      if (args.file !== undefined) {
        const abs = containedPath(ws.root, args.file);
        const st = await fs.stat(abs).catch(() => null);
        if (!st?.isFile()) throw new ToolError(`WAV file not found or not a regular file: ${args.file}`);
        if (st.size > MAX_WAV) throw new ToolError(`${args.file} is ${st.size} bytes; the limit is ${MAX_WAV}.`);
        analysis = analyze(await readInside(ws.root, args.file), { images: true, width: 800, loop: args.loop });
        label = args.file;
      } else if (args.cueId !== undefined) {
        const { asset } = await loadAsset(ctx, args.cueId);
        if (!asset.audio) throw new ToolError(`${asset.id} is not an audio cue.`);
        const cand = args.version ? await readVersion(ws.root, asset.audio.dir, args.version) : await latestVersion(ws.root, asset.audio.dir);
        if (!cand) throw new ToolError(`${asset.id} has no ${args.version ? `candidate v${args.version}` : 'candidate'} yet. Make one with studio_audio_render keep=true.`);
        analysis = analyze(await readInside(ws.root, cand.files['render.wav']), { images: true, width: 800, loop: args.loop ?? JSON.parse(await fs.readFile(containedPath(ws.root, cand.files['source.json']), 'utf8')).loop });
        label = `${asset.id} candidate v${cand.version}`;
        extra = { candidate: { version: cand.version, by: cand.provenance.agent, at: cand.provenance.at, wavSha256: cand.provenance.wavSha256 } };
      } else {
        const { render, doc } = await renderChecked(ws.root, args.document);
        analysis = analyzeRender(render, 800, doc);
        label = `document ${doc.id}`;
      }
    } catch (error) {
      if (error instanceof ToolError) throw error;
      if (error?.code && typeof error.code === 'string' && !error.status) throw new ToolError(`${error.message} (${error.code})`);
      throw error;
    }
    const g = glance(analysis.measurements);
    const out = { source: label, glance: g, measurements: analysis.measurements, ...(analysis.pitch ? { pitch: analysis.pitch } : {}), ...extra,
      images: { waveform: { width: analysis.images.waveform.width, height: analysis.images.waveform.height, axes: analysis.images.waveform.axes },
        spectrogram: { width: analysis.images.spectrogram.width, height: analysis.images.spectrogram.height, axes: analysis.images.spectrogram.axes } }, listening: LISTENING };
    return {
      content: [
        { type: 'text', text: `${label}: ${g.durationMs} ms, ${g.channels}ch ${g.sampleRate} Hz; peak ${g.peakDbfs} dBFS, true peak ${g.truePeakDbtp} dBTP, RMS ${g.rmsDbfs} dBFS, ${g.integratedLufs === null ? `ungated ${g.ungatedLufs} LUFS` : `${g.integratedLufs} LUFS`}; onset ${g.onsetMs} ms, tail ${g.tailMs} ms. Waveform then spectrogram below. ${LISTENING}` },
        { type: 'image', data: analysis.images.waveform.png.toString('base64'), mimeType: 'image/png' },
        { type: 'image', data: analysis.images.spectrogram.png.toString('base64'), mimeType: 'image/png' },
      ],
      structuredContent: out,
    };
  },
};
