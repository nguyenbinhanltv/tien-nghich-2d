import fs from 'node:fs/promises';
import { writeFileAtomic } from '../../core/fsutil.mjs';
import { bodyPlans } from '../../forge/motion/library.mjs';
import { accentsInBrief, encodePng, figureChoice, guidanceText, loadLibrary, renderTemplate, turnaroundLayout } from '../../forge/index.mjs';
import { ToolError } from '../registry.mjs';
import { defaultPoseNames, formatsGuide, forgeCall, routeFor, settingsFor, shown, workDir } from '../workflow/forge.mjs';
import { referenceFor, referenceImage } from '../workflow/reference.mjs';
import { buildPrompt } from '../workflow/prompt.mjs';
import { inkOf, lineupGroup, lineupPicture, loadReferences, standingFrames } from '../workflow/lineup.mjs';
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
    'lineup=true (when the pack defines a lineup group for this profile) draws the approved REFERENCE characters of the group (style-locked entities of the pack) into every template cell as a green ghost, to the left of the guide, standing on the same ground line at the guide\'s height, and returns a second picture, the lineup: the references on one ground line with the allowed height range of a newcomer drawn as dashed lines. Draw your character next to the ghost, not over it; studio_sheet_import and studio_process then measure it against the references (height, head-to-body share, limb width, outline weight) and studio_process and studio_qa_run BLOCK a build outside the pack\'s tolerance, with numbers. The result\'s lineup carries the references, the pose, the tolerance and the typical band. ' +
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
      figure: { type: 'string', maxLength: 31, description: 'Name of the pack figure guide to use (default: the one that lists this asset\'s profile, or, for an asset planned with an inline custom spec, the one that lists its category); "none" for no guide and no proportion text. The result says which guide was used and why.' },
      contacts: { type: 'array', maxItems: 4, items: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,23}$' }, description: 'For a pose sheet: names of the ground contacts you will annotate per pose at import (default left_foot and right_foot). They go into the layout cells as slots.' },
      landmarks: { type: 'array', maxItems: 4, items: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,23}$' }, color: { type: 'string', maxLength: 20 } }, required: ['id', 'color'], additionalProperties: false }, description: 'For a pose sheet: asymmetric marks (id and palette colour id) you will box per pose at import, to turn the mark-side gate on. They go into the layout cells as slots.' },
      heightPx: { type: 'integer', minimum: 4, maximum: 200, description: 'Wanted figure height at native size, ground to crown (default about 65% of the canvas).' },
      lineup: { type: 'boolean', description: 'Draw the pack\'s approved reference characters into the template and return the lineup picture (needs a lineup group for this profile in the pack).' },
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
      for (const l of args.landmarks ?? []) if (!settings.palette.colors.some((c) => c.id === l.color)) throw new ToolError(`landmarks: "${l.color}" is not a palette colour id (see studio_project_info).`);
      // Contact and landmark slots: a pose sheet can say where a foot is planted and where a mark sits, which turns the foot-slide and mark-side gates on.
      const slots = kind === 'pose-sheet' ? { contacts: args.contacts ?? ['left_foot', 'right_foot'], ...(args.landmarks?.length ? { landmarks: args.landmarks } : {}) } : undefined;
      const layout = turnaroundLayout({ id: layoutId, facings, poses, size: [w, h], heightPx: args.heightPx ?? Math.round(profile.nativePx[1] * 0.65), slots });
      const choice = args.figure === 'none' ? null : figureChoice(snap.pack.figures, asset.profile, args.figure, asset.category);
      const named = choice?.figure ?? null;
      const figureUsed = args.figure === 'none' ? { used: null, why: 'figure "none" was asked for: no guide and no proportion text' }
        : choice ? { used: named.name, source: choice.source, why: choice.source === 'explicit' ? 'you named it' : choice.source === 'profile' ? `the guide lists profile ${asset.profile}` : `the asset has no manifest profile (${asset.profile}); the guide lists its category ${asset.category}` }
          : { used: null, why: `no pack figure guide lists profile ${asset.profile}${asset.category ? ` or category ${asset.category}` : ''}${Object.keys(snap.pack.figures ?? {}).length ? `; pass figure: one of ${Object.keys(snap.pack.figures).join(', ')} to use one anyway` : ' (the pack defines no figure guides)'}, so there is no proportion guide or silhouette` };
      if (args.figure && args.figure !== 'none' && !named) throw new ToolError(`No figure guide "${args.figure}" in the project pack. Guides: ${Object.keys(snap.pack.figures ?? {}).join(', ') || 'none are defined'}.`);
      let lineup = null, ghostByFacing = null;
      if (args.lineup) {
        const group = lineupGroup(snap.pack, asset);
        if (!group) throw new ToolError(`The project pack has no lineup group for profile ${asset.profile}. Groups: ${Object.entries(snap.pack.lineup ?? {}).map(([n, g]) => `${n} (${g.profiles.join(', ')})`).join('; ') || 'none are defined'}. Leave out lineup.`);
        const refs = await loadReferences(ws, snap, group, inkOf(snap));
        if (!refs.references.length) throw new ToolError(`The lineup group ${group.name} has no usable reference: ${refs.missing.join('; ')}.`);
        ghostByFacing = new Map();
        for (const facing of new Set([...facings, group.spec.pose.direction])) {
          const frames = await standingFrames(ws.root, snap.index.assets.get(refs.references[0].asset), 'processed', { clip: group.spec.pose.clip, direction: facing });
          if (frames.length) ghostByFacing.set(facing, frames[0].image);
        }
        lineup = { group, ...refs };
      }
      const image = renderTemplate(layout, { figure: named, ghost: ghostByFacing ? (cell) => ghostByFacing.get(cell.facing) ?? ghostByFacing.get(lineup.group.spec.pose.direction) ?? null : undefined });
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

      let lineupPng = null;
      if (lineup) {
        const pic = lineupPicture({ group: lineup.group, references: lineup.references, reference: lineup.reference }, asset, null);
        lineupPng = pic.png;
        if (args.write) {
          const dir = workDir(ws, asset, 'templates'), p = path.join(dir, `${layoutId}-lineup.png`);
          if (!args.dryRun) await writeFileAtomic(p, pic.png);
          files = { ...files, lineup: shown(ws, p) };
        }
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
        figureChoice: figureUsed,
        accents: accentsInBrief(asset.brief, settings.palette.colors),
        ...(slots ? { annotations: { slots, how: 'Optional, turns gates on. At studio_sheet_import pass annotations: {<cell id>: {contacts: [{id, at: [fx, fy], planted: true}], landmarks: [{id, color, box: [fx0, fy0, fx1, fy1]}]}} with every number a FRACTION (0 to 1) of that template cell, from its top left corner. A planted foot turns on foot slide, a landmark box turns on mark side; studio_rig_bake then fills them into poseClips that declare none. Gates with no annotation stay reported as not run.' } } : {}),
        ...(named ? { figure: { name: named.name, description: named.description, headToBody: named.headToBody, minLimbWidthPx: named.minLimbWidthPx, accentMinPixels: named.accentMinPixels, guideDrawn: Boolean(named.guide), measured: named.measured, guidance: guidanceText(named, profile) } } : {}),
        ...(poseClips ? { poseClips } : {}),
        ...(lineup ? { lineup: { group: lineup.group.name, references: lineup.references.map((r) => ({ name: r.name, asset: r.asset, nativePx: r.size, measure: r.measure })), reference: lineup.reference, pose: lineup.group.spec.pose, tolerance: lineup.group.spec.tolerance, typical: lineup.group.spec.typical ?? null,
          guidance: `Each template cell shows ${lineup.references.map((r) => r.name).join(' and ')} (the approved reference) as a green ghost on the left, on the same ground line. Draw your figure beside it at the same scale: its height should be ${Math.round((lineup.group.spec.typical?.heightRatio?.min ?? lineup.group.spec.tolerance.heightRatio?.min ?? 0) * 100)}% to ${Math.round((lineup.group.spec.typical?.heightRatio?.max ?? lineup.group.spec.tolerance.heightRatio?.max ?? 1) * 100)}% of the reference's, the same build (head, limbs, outline weight). A build outside the tolerance is blocked by studio_process and studio_qa_run.`,
          picture: 'the last image: the references on one ground line, dashed lines mark the allowed height range' } } : {}),
        formats: formatsGuide(bodyPlans(), profile),
        motion: { archetypes: Object.fromEntries(Object.entries(libraries).map(([plan, lib]) => [plan, Object.keys(lib.archetypes)])), bodyPlans: Object.fromEntries(Object.entries(libraries).map(([plan, lib]) => [plan, Object.keys(lib.templates).filter((k) => k.startsWith(`${asset.profile}/`)).map((k) => ({ template: k, archetype: lib.templates[k].use }))])) },
        next: ['Draw the sheet with your own image tool.', 'studio_sheet_import with the sheet, this layout, and the verbatim prompt.', 'studio_process to pixelise and look at the native sprites.',
          kind === 'pose-sheet' ? 'studio_rig_bake with poseClips (above) to build the clip from your key poses.' : 'For a clip that moves: studio_rig_bake with a rig; for a single frame: studio_process with submit=true.'],
      };
      return {
        content: [
          { type: 'text', text: `Template ${layoutId} for ${asset.id} (${asset.profile}, ${profile.nativePx.join('x')} native): ${layout.cells.length} cells, ${w}x${h}px. ` +
            `${figureUsed.used ? `Figure guide: ${figureUsed.used} (${figureUsed.why}). ` : `No figure guide: ${figureUsed.why}. `}${out.accents.length ? `Accents in the brief: ${out.accents.map((a) => `${a.word}${a.survives ? ` -> ${a.nearest[0].id}` : ` has NO close palette colour (nearest ${a.nearest[0].id} ${a.nearest[0].hex})`}`).join('; ')}. ` : ''}Routes: ${clips.map((c) => `${c.name}=${c.route}`).join(', ')}. ${files ? (args.dryRun ? `DRY RUN, nothing was written; would save ${files.png}. ` : `Saved: ${files.png}. `) : 'Pass write=true (scope author) to save the PNG for your image tool. '}Layout and details are in the structured result. ${ref ? `Picture 2 is the locked reference of ${ref.name}; its description is in prompt.text.` : ''}${lineupPng ? ' The LAST picture is the lineup: the approved references on one ground line (dashed lines: the allowed height range); each template cell has the reference as a green ghost.' : ''}` },
          { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
          ...(refBytes ? [{ type: 'image', data: refBytes.toString('base64'), mimeType: 'image/png' }] : []),
          ...(lineupPng ? [{ type: 'image', data: lineupPng.toString('base64'), mimeType: 'image/png' }] : []),
        ],
        structuredContent: out,
      };
    });
  },
};
