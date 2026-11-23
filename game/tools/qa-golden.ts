// E9.2 CLI. node tools/qa-golden.ts [--out dir]    compare rendered scenes to tests/golden/images.json (exit 1 on any difference); --out also writes the PNGs
//           node tools/qa-golden.ts --record       rewrite the golden after an intended change (look at the PNGs first: --out dir)
import fs from 'node:fs';
import path from 'node:path';
import { IMAGES_FILE, compareImages, renderAll } from './lib/golden-image.ts';
import type { ImagesGolden } from './lib/golden-image.ts';

const argv = process.argv.slice(2);
const i = argv.indexOf('--out');
const g = await renderAll(i >= 0 ? path.resolve(argv[i + 1]!) : undefined);
if (argv.includes('--record')) {
  fs.mkdirSync(path.dirname(IMAGES_FILE), { recursive: true });
  fs.writeFileSync(IMAGES_FILE, `${JSON.stringify(g, null, 1)}\n`);
  console.log(`recorded ${Object.keys(g.images).length} images to ${path.relative(process.cwd(), IMAGES_FILE)}`);
} else {
  const problems = compareImages(g, JSON.parse(fs.readFileSync(IMAGES_FILE, 'utf8')) as ImagesGolden);
  for (const p of problems) console.error(`ERROR: ${p}`);
  console.log(problems.length ? `qa:golden FAILED: ${problems.length} image(s). Look at them with --out <dir>; if intended: npm run qa:golden -- --record` : `qa:golden OK: ${Object.keys(g.images).length} images match`);
  process.exit(problems.length ? 1 : 0);
}
