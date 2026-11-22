import fs from 'node:fs/promises';
import path from 'node:path';
import { expandArgs, generatorOf, interpreterFile, resolveParams, runProgram, tail, toolchainPath } from '../../core/adapters.mjs';
import { sha256 } from '../../core/fsutil.mjs';
import { ToolError } from '../registry.mjs';
import { callDir, shown } from '../workflow/forge.mjs';
import { cellsOf, pixelOptions, sheetContent, submitBaked } from '../workflow/frames.mjs';
import { framesOf, harvestPngs, sameOutput } from '../workflow/toolchain.mjs';
import { backgroundProp, dryRunProp, inlineOrJob, jsonResult, loadAsset, requireFrames } from './_shared.mjs';
import { check, envelope, sha } from '../workflow/envelope.mjs';
import { requireNotStopped } from '../workflow/stop.mjs';

export default {
  name: 'studio_generator_run',
  title: 'Run a registered generator with parameters and a seed',
  description:
    'Run a deterministic generator that the PROJECT PACK registers (adapters.generators), with validated parameters and a seed, and look at what it drew. ' +
    'This is the code-drawn route for icons, shots, props and tiles. Only registered generators exist: you cannot name another program or pass free text; parameters are checked against the registry ' +
    '(type, range, enum, pattern) and an unknown one is refused, with the list of what is allowed. ' +
    'The generator runs twice in a scratch directory and the outputs must be byte-identical (deterministic), otherwise submit is refused. ' +
    'dryRun is the submit=false preview that writes nothing, not even scratch; with submit=true it lists the files submit would write (submit.wouldWrite). ' +
    'Output PNGs must be named <clip>_<direction>_<n>.png. You get a contact sheet with defects boxed, hashes, and the gate verdict. ' +
    'submit=true commits the frames as raw frames of the asset (provenance records the generator, its script hash, the parameters and the seed). ' +
    'Call with an unknown generator id to see what is registered.',
  scope: 'author',
  inputSchema: {
    type: 'object',
    properties: {
      assetId: { type: 'string', maxLength: 64, description: 'Design asset whose size and outline rule judge the frames, and which submit commits to.' },
      generator: { type: 'string', maxLength: 41, description: 'A generator id registered in the pack (e.g. primitives).' },
      params: { type: 'object', description: 'The generator\'s parameters by name (see its registry entry, or the error for an unknown one). size must equal the asset\'s native size.' },
      seed: { type: 'integer', minimum: 0, maximum: 4294967295, description: 'Seed, for generators that take one (default: the generator\'s own).' },
      submit: { type: 'boolean', description: 'Commit the frames as raw frames of the asset if they pass the gates and the run was deterministic.' },
      scale: { type: 'integer', minimum: 1, maximum: 8, description: 'Preview zoom (default 6).' },
      dryRun: dryRunProp,
      background: backgroundProp,
    },
    required: ['assetId', 'generator'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  async handler(args, ctx) {
    const { ws, snap, asset } = await loadAsset(ctx, args.assetId);
    requireFrames(asset);
    if (args.submit) await requireNotStopped(ws, asset, snap.pack);   // stop policy
    const spec = generatorOf(snap.pack, args.generator);
    const { values, seed } = resolveParams(spec, args.params ?? {}, args.seed);
    const adapters = snap.pack.adapters;
    const interpreter = interpreterFile(ws.root, adapters.interpreter, 'The Python interpreter');
    const script = toolchainPath(ws.root, spec.script, `The generator ${args.generator}`);
    const palette = path.join(ws.root, snap.pack.palette.file);

    return inlineOrJob(ctx, 'generator_run', args, async (log) => {
      const base = await callDir(ws, asset, 'generator', { ephemeral: args.dryRun });
      try {
      const runs = [];
      for (const label of ['a', 'b']) {
        const out = path.join(base, label);
        await fs.mkdir(out, { recursive: true });
        const argv = [...(adapters.interpreter.args ?? []), script, ...expandArgs(spec.args, { ...values, ...(seed !== undefined ? { seed } : {}), out, palette })];
        log(`run ${label}: ${args.generator}`);
        const r = await runProgram({ file: interpreter, argv, cwd: base, timeoutMs: (spec.timeoutSec ?? 30) * 1000 });
        if (r.spawnError) throw new ToolError(`could not start the interpreter: ${r.spawnError}`);
        if (r.timedOut) throw new ToolError(`generator ${args.generator} did not finish in ${spec.timeoutSec ?? 30} s and was stopped.`);
        if (r.code !== 0) throw new ToolError(`generator ${args.generator} failed (exit ${r.code}): ${tail(r.stderr || r.stdout, 1500)}`);
        runs.push({ ...r, harvest: await harvestPngs(out) });
      }
      const [first, second] = runs;
      const deterministic = sameOutput(first.harvest.files, second.harvest.files);
      if (!first.harvest.files.length) throw new ToolError(`generator ${args.generator} wrote no PNG frames to its output directory.${first.stderr ? ` Its error output: ${tail(first.stderr, 800)}` : ''}`);
      const { frames, unmapped } = framesOf(first.harvest.files);
      const options = pixelOptions(snap, asset);
      const cells = cellsOf(frames, options);
      const view = sheetContent({ title: `Generated ${asset.id} with ${args.generator}`, cells, scale: args.scale ?? 6 });
      const scriptHash = sha256(await fs.readFile(script));
      const out = {
        generator: args.generator, params: values, ...(seed !== undefined ? { seed } : {}), script: spec.script, scriptSha256: scriptHash, deterministic,
        files: first.harvest.files.map((f) => ({ name: f.name, sha256: f.sha256, bytes: f.bytes.length })), unmapped, skipped: first.harvest.skipped,
        defects: view.structured.defects, ms: first.ms, ...(args.dryRun ? { dryRun: true, wrote: 'nothing' } : { workDir: shown(ws, base) }), ...view.structured,
      };
      out.qa = envelope({ method: `ran the registered generator ${args.generator} twice in scratch and gated the frames`,
        checks: [check('deterministic', { ok: deterministic, measured: deterministic, threshold: true, detail: 'two runs, byte-identical output' }),
          check('pixelGates', { ok: view.structured.defects.errors === 0, warn: view.structured.defects.warnings > 0, measured: view.structured.defects, threshold: { errors: 0 } }),
          check('namedAsFrames', { ok: unmapped.length === 0, measured: unmapped.length, threshold: 0, detail: 'every output PNG is named <clip>_<direction>_<n>' })],
        notProven: [{ what: 'that the picture is good', why: 'a human reviews the art' }],
        inputs: { script: scriptHash, params: sha({ values, seed }), output: sha(first.harvest.files.map((f) => f.sha256).join(',')) } });
      if (!deterministic) out.warning = 'Two runs with the same arguments gave different bytes: the generator is not deterministic, so its frames cannot be committed.';
      if (args.submit) {
        if (!deterministic) return { content: view.content, structuredContent: { ...out, submit: { accepted: false, message: out.warning } }, isError: true };
        if (unmapped.length) return { content: view.content, structuredContent: { ...out, submit: { accepted: false, message: `${unmapped.length} output file(s) are not frames (${unmapped.map((u) => u.name).join(', ')}); nothing was committed.` } }, isError: true };
        const { accepted, report } = await submitBaked({ ws, snap, asset, frames, caller: ctx.caller, dryRun: args.dryRun,
          provenance: { tool: `generator ${args.generator}`, generator: spec.script, sourceHash: scriptHash, notes: `params ${JSON.stringify(values)}${seed !== undefined ? `; seed ${seed}` : ''}; deterministic (two runs identical)` } });
        out.submit = { accepted, ...(args.dryRun ? { dryRun: true, wouldWrite: report.wouldWrite } : { written: report.written }), unchanged: report.unchanged, message: report.message,
          frames: accepted ? undefined : report.frames?.filter((f) => f.errors || f.problem).map((f) => ({ name: f.name, errors: f.errors, problem: f.problem, defects: f.defects?.slice(0, 20) })) };
        if (!accepted) return { content: view.content, structuredContent: out, isError: true };
        view.content[0].text += args.dryRun ? ` DRY RUN: would commit ${report.wouldWrite.length} raw frame(s); nothing was written.` : ` Committed ${report.written.length} raw frame(s) (status pending).`;
      }
      out.next = args.dryRun ? 'Nothing was written. Run again without dryRun to write.' : out.submit?.accepted ? 'studio_qa_run from a different session (independent=true), then studio_review_request.' : 'Look at the sheet. Change the parameters or seed, or run again with submit=true.';
      return { content: view.content, structuredContent: out };
      } finally { if (args.dryRun) await fs.rm(base, { recursive: true, force: true }); }
    });
  },
};
