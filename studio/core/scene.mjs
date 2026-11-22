// Compose a scene from sprite layers: a background (flat colour, checkerboard or a repeated tile), then layers in
// order, each placed by its pivot. Native pixels first, then a nearest-neighbour upscale, so what is returned is
// exactly what the engine would draw. Pure: no files, no project knowledge.

const clampByte = v => Math.max(0, Math.min(255, v));

/** An RGBA image filled with a colour. */
export function fillImage(width, height, rgb) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) pixels.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  return {width, height, pixels};
}

/** Background: {kind: 'flat', rgb} | {kind: 'checker', rgb, rgb2, cell} | {kind: 'tile', image}. */
export function background(width, height, spec) {
  if (spec.kind === 'flat') return fillImage(width, height, spec.rgb);
  const out = fillImage(width, height, spec.rgb ?? [0, 0, 0]);
  if (spec.kind === 'checker') {
    const cell = spec.cell ?? 4;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (((Math.floor(x / cell) + Math.floor(y / cell)) & 1) === 1) out.pixels.set([spec.rgb2[0], spec.rgb2[1], spec.rgb2[2], 255], (y * width + x) * 4);
    }
  } else if (spec.kind === 'tile') {
    const {image: t} = spec;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const k = ((y % t.height) * t.width + (x % t.width)) * 4;
      if (t.pixels[k + 3]) out.pixels.set([t.pixels[k], t.pixels[k + 1], t.pixels[k + 2], 255], (y * width + x) * 4);
    }
  } else throw new Error(`unknown background kind ${spec.kind}`);
  return out;
}

/** Draw `image` onto `scene` so that its `pivot` lands on `at`. Opaque pixels only (sprites have binary alpha). Returns the rectangle drawn. */
export function place(scene, image, pivot, at) {
  const x0 = at[0] - pivot[0], y0 = at[1] - pivot[1];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const sx = x0 + x, sy = y0 + y;
    if (sx < 0 || sy < 0 || sx >= scene.width || sy >= scene.height) continue;
    const k = (y * image.width + x) * 4;
    if (image.pixels[k + 3] !== 255) continue;
    image.pixels.copy(scene.pixels, (sy * scene.width + sx) * 4, k, k + 4);
  }
  return {x: x0, y: y0, w: image.width, h: image.height};
}

/** Mark a native pixel (a 1px cross) so an anchor can be seen; `rgb` should not be a palette colour the sprites use. */
export function mark(scene, at, rgb) {
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = at[0] + dx, y = at[1] + dy;
    if (x >= 0 && y >= 0 && x < scene.width && y < scene.height) scene.pixels.set([rgb[0], rgb[1], rgb[2], 255], (y * scene.width + x) * 4);
  }
}

/** Nearest-neighbour upscale by an integer factor. */
export function upscale(image, n) {
  const width = image.width * n, height = image.height * n;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    image.pixels.copy(pixels, (y * width + x) * 4, (Math.floor(y / n) * image.width + Math.floor(x / n)) * 4, (Math.floor(y / n) * image.width + Math.floor(x / n)) * 4 + 4);
  }
  return {width, height, pixels};
}

export const clamp = clampByte;
