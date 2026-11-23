import { submitFrames } from '../../core/submissions.mjs';
import { MAX_CANDIDATES, submitCandidates } from '../../core/candidates.mjs';
import { ToolError } from '../registry.mjs';
import { dryRunProp, jsonResult, loadAsset, recordImageSpend, requireFrames } from './_shared.mjs';
import { check, envelope, sha } from '../workflow/envelope.mjs';
import { requireNotStopped } from '../workflow/stop.mjs';
import { judgeFrames } from '../workflow/clipgates.mjs';
import { settingsFor } from '../workflow/forge.mjs';

const frameItem = {
  type: 'object',
  properties: {
    clip: { type: 'string', maxLength: 40, description: 'Clip name from the asset spec (e.g. idle).' },
    direction: { type: 'string', maxLength: 10, description: 'south, west, north, east, or none.' },
    n: { type: 'integer', minimum: 0, description: 'Frame index within the clip, 0-based.' },
    file: { type: 'string', maxLength: 300, description: 'Project-relative path to a PNG you wrote (preferred; keeps the call small).' },
    pngBase64: { type: 'string', maxLength: 140000, description: 'The PNG as canonical base64, instead of file.' },
  },
  required: ['clip', 'direction', 'n'],
  additionalProperties: false,
};

export default {
  name: 'studio_frames_submit',
  title: 'Submit native frames with provenance',
  description:
    'Submit native-size PNG frames for a Longtime asset, with mandatory provenance (tool, prompt or generator, source hash). ' +
    'The pixel gates run first: palette membership, binary alpha, the silhouette outline, exact canvas size. If any frame has an error, NOTHING is written and every defect comes back with x, y coordinates. ' +
    'When the batch holds every frame of a clip and facing, the CLIP gates run on it too, with the limits of a drawn clip, and the result carries them in clipGates and in the qa checks frameGates (pivot drift, ground contact: the lowest opaque row must be within 1 px of the pivot row minus 2, with the shift that fixes a miss), paletteGates (the pixel palette check plus stability between clips) and motionGates (flicker, identity drift); foot slide, mark side and weight transfer are listed as not run. They report and never block the write; a partial clip is listed with what is missing. ' +
    'Accepted frames are written once under the asset\'s raw frames directory and never overwritten; submitting different pixels for an existing frame is refused. ' +
    'Each frame gets a revision history that starts as pending: only a human approves. dryRun runs the gates and lists the files it would write (wouldWrite) and the ones already stored (unchanged), writing nothing. ' +
    'Works only on Longtime assets that have no processed or packed frames yet. ' +
    'Instead of frames you may give candidates (1 to 6, each the same frames): the pixel gates reject the broken ones first, the survivors are stored as takes (new revisions; nothing is replaced) and one candidate run is recorded for a person to compare on one contact sheet beside the reference. ' +
    'Nothing is selected and nothing in use changes: only a person picks, in the Review tab, and no tool can.',
  scope: 'author',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Longtime asset id (see studio_catalog_search source=longtime status=planned).' },
      frames: { type: 'array', minItems: 1, maxItems: 128, items: frameItem, description: 'Frames to submit; each is addressed by clip, direction and n. Give this or candidates.' },
      candidates: {
        type: 'array', minItems: 1, maxItems: MAX_CANDIDATES,
        description: 'Several candidates for the same frames. Give this or frames.',
        items: { type: 'object', properties: {
          label: { type: 'string', maxLength: 24, description: 'Short name (default A, B, C...).' },
          frames: { type: 'array', minItems: 1, maxItems: 128, items: frameItem },
          provenance: { type: 'object', description: 'Fields that differ for this candidate (its own prompt or sourceHash), merged over the shared provenance.',
            properties: { prompt: { type: 'string', maxLength: 8000 }, sourceHash: { type: 'string', pattern: '^[0-9a-f]{64}$' }, notes: { type: 'string', maxLength: 2000 } }, additionalProperties: false },
        }, required: ['frames'], additionalProperties: false },
      },
      note: { type: 'string', maxLength: 600, description: 'With candidates: what differs between them, for the person who picks.' },
      reference: { type: 'string', maxLength: 300, description: 'With candidates: project-relative path of the reference picture shown beside the sheet (default: the asset\'s reference in the project pack).' },
      provenance: {
        type: 'object',
        properties: {
          tool: { type: 'string', maxLength: 200, description: 'What made the pixels: the image tool, or the program, with version if known.' },
          prompt: { type: 'string', maxLength: 8000, description: 'What you asked the tool. Give this or generator.' },
          generator: { type: 'string', maxLength: 300, description: 'Project-relative path of the program that drew the frames. Give this or prompt.' },
          sourceHash: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'Lowercase sha256 of the source image, sheet or generator output the frames came from.' },
          rights: { type: 'string', maxLength: 500, description: 'Licence or rights statement, if any.' },
          parentIds: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 64 }, description: 'Asset ids this was derived from.' },
          notes: { type: 'string', maxLength: 2000, description: 'Anything a reviewer should know.' },
        },
        required: ['tool', 'sourceHash'],
        additionalProperties: false,
      },
      generations: { type: 'integer', minimum: 1, maximum: 64, description: 'How many image-tool generations these frames came from (default 1). The studio records it for the quota; it cannot refuse an image tool that already ran.' },
      qa: { type: 'object', description: 'Clip gate options, e.g. {"groundContact": false} for a floating figure, {"flicker": {"maxPixels": 30}}, {"identity": {"maxInteriorChange": 0.5}}; false turns a gate off and it then shows as not run.' },
      dryRun: dryRunProp,
    },
    required: ['assetId', 'provenance'],
    additionalProperties: false,
  },
  // Not idempotent: with candidates a repeated call stores the survivors again as new takes and records another run.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  async handler({ assetId, frames, candidates, note, reference, provenance, generations, dryRun, qa }, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, assetId);
    requireFrames(asset);
    if ((frames === undefined) === (candidates === undefined)) throw new ToolError('Give exactly one of frames or candidates.');
    if (!dryRun) await requireNotStopped(ws, asset, snap.pack);   // stop policy
    if (candidates) {
      const r = await submitCandidates({ ws, pack: snap.pack, palette: snap.palette, index: snap.index, asset, candidates, provenance, note, reference, caller: ctx.caller, dryRun });
      const failed = r.candidates.filter((c) => c.verdict === 'rejected').length;
      r.qa = envelope({ method: `${dryRun ? 'dry run of ' : ''}the pixel gates over ${r.candidates.length} candidate(s)`,
        checks: [check('pixelGates', { ok: failed === 0, warn: failed > 0 && failed < r.candidates.length, measured: { rejected: failed, survivors: r.candidates.length - failed }, threshold: { rejected: 0 } })],
        notProven: [{ what: 'which candidate is best', why: 'only a person judges that, on the contact sheet, in the Review tab' }] });
      if (!dryRun) r.quota = await recordImageSpend(ctx, { tool: provenance.tool, generations: generations ?? candidates.length, assetId });   // every candidate was a generation, kept or not
      return jsonResult(dryRun ? { ...r, wrote: 'nothing' } : r, !r.accepted);
    }
    // An asset that is not open for frames is refused by submitFrames with its own message; the clip gates then have nothing to judge.
    const forge = await settingsFor(snap, ws, asset).catch(() => null);
    const judge = forge ? (images) => judgeFrames({ asset, images, settings: forge.settings, palette: forge.palette, qa }) : undefined;
    const { accepted, report } = await submitFrames({ ws, pack: snap.pack, palette: snap.palette, index: snap.index, asset, frames, provenance, caller: ctx.caller, dryRun, judge });
    const frameErrors = report.frames?.reduce((n, f) => n + (f.errors ?? 0), 0) ?? 0;
    const clip = report.clipGates;
    const group = (name) => clip?.groups?.[name];
    const groupCheck = (name, label, extra = {}) => (group(name) ? [check(label, { ok: group(name).pass && (extra.ok ?? true), warn: group(name).warnings > 0, measured: { errors: group(name).errors, warnings: group(name).warnings, ran: group(name).ran, ...(extra.measured ?? {}) }, threshold: { errors: 0 } })] : []);
    report.qa = envelope({ method: `${dryRun ? 'dry run of ' : ''}the pixel gates over ${report.frames?.length ?? 0} submitted frame(s)${clip?.judged?.length ? `, then the clip gates over ${clip.judged.length} complete clip facing(s)` : ''}`,
      checks: [check('pixelGates', { ok: frameErrors === 0, warn: report.frames?.some((f) => f.warnings > 0), measured: { errorPixels: frameErrors }, threshold: { errorPixels: 0 } }),
        ...groupCheck('frame', 'frameGates'), ...groupCheck('palette', 'paletteGates', { ok: frameErrors === 0, measured: { errorPixels: frameErrors } }), ...groupCheck('motion', 'motionGates')],
      notProven: [{ what: 'the rest of the asset', why: 'only the frames in this batch were judged; studio_qa_run judges the whole asset' },
        ...(clip?.partial ?? []).map((p) => ({ what: `clip gates for ${p.clip} ${p.direction}`, why: p.why })),
        ...(clip?.notRun ?? []).map((n) => ({ what: `${n.gate} for ${n.clips.join(', ')}`, why: n.reason, ...(n.turnOn ? { turnOn: n.turnOn } : {}) })),
        ...(clip?.judged?.length ? [] : [{ what: 'clip gates (frame, palette stability, flicker and identity drift)', why: 'no clip of this batch is complete: submit every frame of a clip and facing together' }])],
      inputs: Object.fromEntries((report.frames ?? []).slice(0, 40).map((f) => [f.name, f.sha256])) });
    if (accepted && !dryRun && report.written?.length) report.quota = await recordImageSpend(ctx, { tool: provenance.tool, generations, assetId });
    return jsonResult(dryRun ? { ...report, wrote: 'nothing' } : report, !accepted);
  },
};
