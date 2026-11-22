import fs from 'node:fs/promises';
import { writeFileAtomic } from '../../core/fsutil.mjs';
import { bodyPlans } from '../../forge/motion/library.mjs';
import { encodePng, figureFor, guidanceText, loadLibrary, renderTemplate, turnaroundLayout } from '../../forge/index.mjs';
import { ToolError } from '../registry.mjs';
import { defaultPoseNames, formatsGuide, forgeCall, routeFor, settingsFor, shown, workDir } from '../workflow/forge.mjs';
import { referenceFor, referenceImage } from '../workflow/reference.mjs';
import { buildPrompt } from '../workflow/prompt.mjs';
import { dryRunProp, loadAsset, requireFrames, requireScope } from './_shared.mjs';
import path from 'node:path';

const FACINGS = ['south', 'west', 'north', 'east'];

export default {
  name: 'studio_template_get',
  title: 'Get the sheet template and the motion options for an asset',
  description:
    'Everything you need to start making an asset: its profile (native size, pivot, directions, clips with frame counts and timings), the RECOMMENDED ROUTE for each clip, ' +
    'the motion templates the forge has for it, and a layout plus a template image to draw on. ' +
    'Routes (decided in the forge bake-off): a single frame is drawn on a sheet and pixelised; LOCOMOTION clips (walk, follow, advance...) start from drawn KEY POSES on a pose sheet (kind="pose-sheet", clip=<that clip>); ' +
    'IDLE and small motions are baked from a RIG with a motion template; asymmetric marks (a coloured ear, a held tool in one hand) are kept with studio_process marks and fixed with studio_frame_patch. ' +
    'kind="turnaround" gives one drawing per facing; kind="pose-sheet" gives one per pose and facing. Draw with your own image tool on a pure green key, using the template file as the reference. ' +
    'If the project pack defines a figure guide for this profile (pack figures), the result carries its proportions as text for your image prompt (head share, minimum limb width, pixels an accent colour needs) and the template cells show a guide silhouette in dimmed green (it keys out as background): fit your figure to it. ' +
    'The result also carries formats: the compact shape of the rig and poseClips documents that studio_rig_bake takes, with the rules (coordinates, roles, which annotations turn which gate on), so you need not read source. ' +
    'It also returns prompt: a ready skeleton for your image prompt that follows fixed conventions (the role of each reference image by position, framing as percentages of a cell, each facing said three ways, near and far limbs named, then the proportions and the project style). ' +
    'If the asset has a locked reference in the pack (a style-locked entity: an approved image and a description paragraph), the result carries that image as a second picture, its description goes into prompt.text verbatim, and studio_sheet_import checks and records that your prompt carries it. ' +
    'write=true (needs scope author) saves the template PNG where your image tool can read it (with dryRun it only lists the files it would save). Returns the layout; pass it, or its layoutId, to studio_sheet_import.',
  scope: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Design asset id, e.g. lt_reed_crane.' },
      kind: { type: 'string', enum: ['turnaround', 'pose-sheet'], description: 'turnaround (default): one cell per facing. pose-sheet: one cell per key pose and facing (needs clip).' },
      clip: { type: 'string', maxLength: 40, description: 'For a pose sheet: the clip whose key poses you will draw (one pose per frame of the clip).' },
      facings: { type: 'array', maxItems: 4, items: { type: 'string', enum: FACINGS }, description: 'Facings to draw (default: the profile\'s directions).' },
      poses: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,23}$' }, description: 'Pose names for a pose sheet (default: contact/passing names matching the clip\'s frame count).' },
      size: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: 512, maximum: 2048 }, description: 'Template size in pixels (default [1024, 1024]); the drawn sheet may be any size.' },
      figure: { type: 'string', maxLength: 31, description: 'Name of the pack figure guide to use (default: the one that lists this asset\'s profile); "none" for no guide and no proportion text.' },
      heightPx: { type: 'integer', minimum: 4, maximum: 200, description: 'Wanted figure height at native size, ground to crown (default about 65% of the canvas).' },
      write: { type: 'boolean', description: 'Save the template PNG and layout under the work directory and return their paths (needs scope author).' },
      dryRun: dryRunProp,
    },
    required: ['assetId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
  async handler(args, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, args.assetId);
    requireFrames(asset);
    if (args.write) requireScope(ctx, 'author', 'Saving a template');
    return forgeCall(async () => {
      const { settings } = await settingsFor(snap, ws, asset);
      const profile = settings.profile;
      const facings = args.facings ?? asset.directions.filter((d) => FACINGS.includes(d));
      if (!facings.length) throw new ToolError(`${asset.id} has no facings to draw (directions: ${asset.directions.join(', ')}); a single static frame needs facing "none", which a sheet cannot express. Use studio_frame_patch to draw it, or a generator.`);

      // Motion options and the route per clip, from the shipped libraries.
      const libraries = Object.fromEntries(Object.keys(bodyPlans()).map((plan) => [plan, loadLibrary(plan)]));
      const clips = Object.entries(asset.clips).map(([name, c]) => {
        const archetypes = Object.fromEntries(Object.entries(libraries).map(([plan, lib]) => [plan, lib.templates[`${asset.profile}/${name}`]?.use ?? null]));
        const archetype = Object.values(archetypes).find(Boolean) ?? null;
        return { name, frames: c.frames, frameMs: c.frameMs, motionArchetype: archetypes, ...routeFor(name, c.frames, archetype) };
      });

      const kind = args.kind ?? 'turnaround';
      let poses = [null], poseClips;
      if (kind === 'pose-sheet') {
        if (!args.clip) throw new ToolError(`A pose sheet is for one clip. Give clip: one of ${Object.keys(asset.clips).join(', ')}.`);
        const spec = asset.clips[args.clip];
        if (!spec) throw new ToolError(`${asset.id} has no clip "${args.clip}". Clips: ${Object.keys(asset.clips).join(', ')}`);
        poses = args.poses ?? defaultPoseNames(spec.frames);
        if (poses.length !== spec.frames) throw new ToolError(`clip ${args.clip} has ${spec.frames} frames, so a pose sheet needs ${spec.frames} poses (you gave ${poses.length}).`);
        poseClips = { schema: 'forge.poseclips', version: 1, clips: { [args.clip]: { keys: poses, facings, loop: true } } };
      }
      const [w, h] = args.size ?? [1024, 1024];
      const layoutId = `${asset.id}-${kind}${args.clip ? `-${args.clip}` : ''}`.replace(/_/g, '-');
      const layout = turnaroundLayout({ id: layoutId, facings, poses, size: [w, h], heightPx: args.heightPx ?? Math.round(profile.nativePx[1] * 0.65) });
      const named = args.figure === 'none' ? null : figureFor(snap.pack.figures, asset.profile, args.figure);
      if (args.figure && args.figure !== 'none' && !named) throw new ToolError(`No figure guide "${args.figure}" in the project pack. Guides: ${Object.keys(snap.pack.figures ?? {}).join(', ') || 'none are defined'}.`);
      const image = renderTemplate(layout, { figure: named });
      const png = Buffer.from(encodePng(image));

      let files;
      if (args.write) {
        const dir = workDir(ws, asset, 'templates');
        const pngPath = path.join(dir, `${layoutId}.png`), layoutPath = path.join(dir, `${layoutId}.layout.json`);
        if (!args.dryRun) {
          await fs.mkdir(dir, { recursive: true });
          await writeFileAtomic(pngPath, png);
          await writeFileAtomic(layoutPath, JSON.stringify(layout, null, 2) + '\n');
        }
        files = { png: shown(ws, pngPath), layout: shown(ws, layoutPath) };
      }

      const ref = referenceFor(snap.pack, asset.id);
      const refBytes = ref ? await referenceImage(ws, ref) : null;
      const prompt = buildPrompt({ layout, nativePx: profile.nativePx, poses: kind === 'pose-sheet' ? poses : null, reference: ref, referenceName: ref?.name,
        style: snap.pack.agentGuidance?.prompt ?? {}, proportions: named ? guidanceText(named, profile) : '' });
      const out = {
        ...(args.dryRun ? { dryRun: true, wrote: 'nothing' } : {}),
        asset: { id: asset.id, profile: asset.profile, nativePx: profile.nativePx, pivotPx: profile.pivotPx, directions: asset.directions },
        clips,
        template: { layoutId, kind, size: [w, h], cells: layout.cells.map((c) => ({ id: c.id, label: c.label, facing: c.facing, pose: c.pose })), ...(files ? (args.dryRun ? { wouldWrite: files } : { files }) : {}),
          drawing: `Draw on a pure green (0,255,0) background, one figure per cell, feet on the grey guide line, nothing in the label band at the top of a cell, ${profile.nativePx.join('x')} native pixels will be a small fraction of the drawing so keep shapes bold. Do not draw the labels.${named ? ` ${guidanceText(named, profile)}` : ''}` },
        prompt: { ...prompt, ...(ref ? { reference: { name: ref.name, image: ref.image, sha256: ref.sha256, approved: ref.approved, description: ref.description } } : {}) },
        layout,
        ...(named ? { figure: { name: named.name, description: named.description, headToBody: named.headToBody, minLimbWidthPx: named.minLimbWidthPx, accentMinPixels: named.accentMinPixels, guideDrawn: Boolean(named.guide), measured: named.measured, guidance: guidanceText(named, profile) } } : {}),
        ...(poseClips ? { poseClips } : {}),
        formats: formatsGuide(bodyPlans(), profile),
        motion: { bodyPlans: Object.fromEntries(Object.entries(libraries).map(([plan, lib]) => [plan, Object.keys(lib.templates).filter((k) => k.startsWith(`${asset.profile}/`)).map((k) => ({ template: k, archetype: lib.templates[k].use }))])) },
        next: ['Draw the sheet with your own image tool.', 'studio_sheet_import with the sheet, this layout, and the verbatim prompt.', 'studio_process to pixelise and look at the native sprites.',
          kind === 'pose-sheet' ? 'studio_rig_bake with poseClips (above) to build the clip from your key poses.' : 'For a clip that moves: studio_rig_bake with a rig; for a single frame: studio_process with submit=true.'],
      };
      return {
        content: [
          { type: 'text', text: `Template ${layoutId} for ${asset.id} (${asset.profile}, ${profile.nativePx.join('x')} native): ${layout.cells.length} cells, ${w}x${h}px. ` +
            `Routes: ${clips.map((c) => `${c.name}=${c.route}`).join(', ')}. ${files ? (args.dryRun ? `DRY RUN, nothing was written; would save ${files.png}. ` : `Saved: ${files.png}. `) : 'Pass write=true (scope author) to save the PNG for your image tool. '}Layout and details are in the structured result. ${ref ? `Picture 2 is the locked reference of ${ref.name}; its description is in prompt.text.` : ''}` },
          { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
          ...(refBytes ? [{ type: 'image', data: refBytes.toString('base64'), mimeType: 'image/png' }] : []),
        ],
        structuredContent: out,
      };
    });
  },
};
