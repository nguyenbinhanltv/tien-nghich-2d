import { submitFrames } from '../../core/submissions.mjs';
import { dryRunProp, jsonResult, loadAsset, requireFrames } from './_shared.mjs';

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
    'Accepted frames are written once under the asset\'s raw frames directory and never overwritten; submitting different pixels for an existing frame is refused. ' +
    'Each frame gets a revision history that starts as pending: only a human approves. dryRun runs the gates and lists the files it would write (wouldWrite) and the ones already stored (unchanged), writing nothing. ' +
    'Works only on Longtime assets that have no processed or packed frames yet.',
  scope: 'author',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Longtime asset id (see studio_catalog_search source=longtime status=planned).' },
      frames: { type: 'array', minItems: 1, maxItems: 128, items: frameItem, description: 'Frames to submit; each is addressed by clip, direction and n.' },
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
      dryRun: dryRunProp,
    },
    required: ['assetId', 'frames', 'provenance'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  async handler({ assetId, frames, provenance, dryRun }, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, assetId);
    requireFrames(asset);
    const { accepted, report } = await submitFrames({ ws, pack: snap.pack, palette: snap.palette, index: snap.index, asset, frames, provenance, caller: ctx.caller, dryRun });
    return jsonResult(dryRun ? { ...report, wrote: 'nothing' } : report, !accepted);
  },
};
