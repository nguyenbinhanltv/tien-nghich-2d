import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { IMAGES_FILE, IMAGE_SCENARIOS, SIZES, compareImages, hashImage, newImage, renderAll, renderScenario, toDevice, upscale } from '../tools/lib/golden-image.ts';
import type { ImagesGolden } from '../tools/lib/golden-image.ts';
import { VIEW_H, VIEW_W } from '../src/contracts/world.ts';

describe('E9.2 golden images (software render)', () => {
  it('every scene at every viewport matches tests/golden/images.json', async () => {
    const want = JSON.parse(fs.readFileSync(IMAGES_FILE, 'utf8')) as ImagesGolden;
    expect(compareImages(await renderAll(), want)).toEqual([]);
    expect(Object.keys(want.images)).toHaveLength(IMAGE_SCENARIOS.length * SIZES.length);
  }, 60_000);
  it('rendering is deterministic: two renders of a scene hash the same', async () => {
    const s = IMAGE_SCENARIOS[1]!;
    expect(hashImage(await renderScenario(s))).toBe(hashImage(await renderScenario(s)));
  });
  it('the scenes differ from each other (the fight moves the actors)', async () => {
    const h = await Promise.all(IMAGE_SCENARIOS.map(async (s) => hashImage(await renderScenario(s))));
    expect(new Set(h).size).toBe(h.length);
  });
  it('upscale repeats each pixel k x k times', () => {
    const a = newImage(2, 1, [10, 20, 30]); a.px.set([200, 100, 50, 255], 4);
    const b = upscale(a, 3);
    expect([b.width, b.height]).toEqual([6, 3]);
    expect(Array.from(b.px.subarray(0, 4))).toEqual([10, 20, 30, 255]);
    expect(Array.from(b.px.subarray((2 * 6 + 5) * 4, (2 * 6 + 5) * 4 + 4))).toEqual([200, 100, 50, 255]);
  });
  it('the device image is the logical frame at an integer scale, centred, with black bars', async () => {
    const logical = await renderScenario(IMAGE_SCENARIOS[0]!);
    for (const [w, h, dpr, scale] of [[1280, 720, 1, 3], [844, 390, 3, 5], [1920, 1080, 2, 10]] as const) {
      const { image, scale: s } = toDevice(logical, w, h, dpr);
      expect(s).toBe(scale);
      expect([image.width, image.height]).toEqual([w * dpr, h * dpr]);
      const ox = (image.width - VIEW_W * s) / 2, oy = (image.height - VIEW_H * s) / 2;
      expect(ox).toBeGreaterThanOrEqual(0); expect(oy).toBeGreaterThanOrEqual(0);
      const px = (x: number, y: number): number[] => Array.from(image.px.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3));
      if (ox >= 1) expect(px(0, 0)).toEqual([0, 0, 0]);
      const lx = 100, ly = 150, o = (ly * VIEW_W + lx) * 4;
      expect(px(Math.floor(ox) + lx * s + (s - 1), Math.floor(oy) + ly * s + (s - 1))).toEqual(Array.from(logical.px.subarray(o, o + 3)));
    }
  });
  it('a changed image is reported with its name and hash prefix', async () => {
    const want = JSON.parse(fs.readFileSync(IMAGES_FILE, 'utf8')) as ImagesGolden;
    const bad = structuredClone(want); bad.images['arena_start@logical']!.sha256 = '0'.repeat(64);
    expect(compareImages(want, bad).join('\n')).toMatch(/arena_start@logical: pixels differ \(got [0-9a-f]{12}, golden 000000000000\)/);
  });
});
