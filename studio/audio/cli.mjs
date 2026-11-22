#!/usr/bin/env node
// node studio/audio/cli.mjs validate <doc.json>
// node studio/audio/cli.mjs render  <doc.json> --out <file.wav> [--project <root>] [--report <file.json>] [--images <dir>]
// node studio/audio/cli.mjs analyze <file.wav|doc.json> [--out-dir <dir>] [--loop <start:end>] [--width <px>]
// analyze writes nothing unless --out-dir is given (then it writes the two PNGs there); without it only the figures print.
// JSON goes to stdout; problems go to stderr with exit code 1. No agent listens to anything here: figures and pictures only.
import fs from 'node:fs/promises';
import path from 'node:path';
import { renderDocument } from './render.mjs';
import { validateDocument, documentKind } from './validate.mjs';
import { analyze, audioFromPcm } from './analyze.mjs';
import { projectAudio, applyProjectRate, insideProtected } from './project.mjs';

function parse(argv) {
  const [command, ...rest] = argv;
  const positional = [], flags = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      const name = rest[i].slice(2);
      flags[name] = rest[++i];
    } else positional.push(rest[i]);
  }
  return {command, positional, flags};
}

const fail = (message, code = 1) => { process.stderr.write(JSON.stringify({error: message}) + '\n'); process.exit(code); };
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

async function writeImages(dir, stem, images) {
  await fs.mkdir(dir, {recursive: true});
  const files = {};
  for (const [name, img] of Object.entries(images)) {
    const file = path.join(dir, `${stem}.${name}.png`);
    await fs.writeFile(file, img.png);
    files[name] = {file, width: img.width, height: img.height, axes: img.axes};
  }
  return files;
}

// Every path the command would write goes through here before anything is written.
async function guardedOutputs(project, paths) {
  if (!project) return;
  const info = await projectAudio(project);
  for (const target of paths.filter(Boolean))
    if (insideProtected(project, info.protectedDirs, target))
      fail(`Refusing to write ${target}: it is inside the project's delivered audio directories. Write into a scratch or experiments directory.`);
}

async function main() {
  const {command, positional, flags} = parse(process.argv.slice(2));
  if (!['validate', 'render', 'analyze'].includes(command) || !positional[0])
    fail('usage: cli.mjs validate <doc.json> | render <doc.json> --out <file.wav> | analyze <file.wav|doc.json>');
  const input = positional[0];
  if (command === 'analyze') await guardedOutputs(flags.project, [flags['out-dir']]);
  if (command === 'analyze' && /\.wav$/i.test(input)) {
    const loop = flags.loop ? (([s, e]) => ({start: Number(s), end: Number(e)}))(flags.loop.split(':')) : undefined;
    const result = analyze(await fs.readFile(input), {loop, images: Boolean(flags['out-dir']), width: flags.width ? Number(flags.width) : undefined});
    const out = {source: result.source, measurements: result.measurements};
    if (result.images) out.images = await writeImages(flags['out-dir'], path.basename(input, path.extname(input)), result.images);
    return process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  }
  let doc = await readJson(input);
  if (flags.project) doc = applyProjectRate(doc, (await projectAudio(flags.project)).sampleRate);
  const issues = validateDocument(doc);
  if (command === 'validate') {
    process.stdout.write(JSON.stringify({valid: issues.length === 0, kind: documentKind(doc), issues}, null, 2) + '\n');
    process.exit(issues.length ? 1 : 0);
  }
  if (issues.length) fail(`Invalid document:\n  ${issues.join('\n  ')}`);
  if (command === 'render') {
    if (!flags.out) fail('render needs --out <file.wav>');
    await guardedOutputs(flags.project, [flags.out, flags.images, flags.report]);
    const render = renderDocument(doc);
    await fs.mkdir(path.dirname(path.resolve(flags.out)), {recursive: true});
    await fs.writeFile(flags.out, render.wav);
    const result = analyze(doc, {images: Boolean(flags.images)});
    const summary = {id: render.id, kind: render.kind, out: flags.out, frames: render.frames, sampleRate: render.sampleRate, channels: render.channels,
      loop: render.loop, scale: render.scale, measurements: result.measurements, pitch: result.pitch};
    if (result.images) summary.images = await writeImages(flags.images, render.id, result.images);
    if (flags.report) await fs.writeFile(flags.report, JSON.stringify(summary, null, 2) + '\n');
    return process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  }
  const result = analyze(doc, {images: Boolean(flags['out-dir']), width: flags.width ? Number(flags.width) : undefined});
  const out = {source: result.source, measurements: result.measurements, pitch: result.pitch};
  if (result.images) out.images = await writeImages(flags['out-dir'], doc.id, result.images);
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

main().catch(error => fail(error.message));
