import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { privateAddresses } from './lan.ts';
import { ATLAS_RE, isLocalAddress } from './vite-plugin.ts';
import { KILN_PAGE_COUNT } from '../src/render/kiln-loader.ts';

const GAME = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('isLocalAddress', () => {
  it('accepts loopback and private ranges', () => {
    for (const a of ['127.0.0.1', '::1', '::ffff:192.168.1.20', '10.0.0.5', '172.16.0.1', '172.31.255.1', '192.168.0.9', '169.254.1.1', 'fd12::1', 'fe80::1']) expect(isLocalAddress(a), a).toBe(true);
  });
  it('rejects public and malformed addresses', () => {
    for (const a of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '203.0.113.9', '2001:db8::1', '', undefined]) expect(isLocalAddress(a), String(a)).toBe(false);
  });
});

describe('privateAddresses', () => {
  const mk = (address: string, internal = false) => ({ address, family: 'IPv4' as const, internal, netmask: '', mac: '', cidr: null });
  it('only returns private non-loopback IPv4, never 0.0.0.0 or public', () => {
    const got = privateAddresses({ lo0: [mk('127.0.0.1', true)], en0: [mk('192.168.1.9')], utun: [mk('100.64.0.2')], eth9: [mk('203.0.113.4')] });
    expect(got).toEqual([{ name: 'en0', address: '192.168.1.9' }]);
  });
});

describe('atlas allow-list', () => {
  it('matches atlas pages and nothing else', () => {
    expect(ATLAS_RE.test('atlases/mobile/atlas-3.png')).toBe(true);
    expect(ATLAS_RE.test('atlases/mobile/atlas-3.json')).toBe(true);
    expect(ATLAS_RE.test('atlases/mob-runtime.json')).toBe(true);
    expect(ATLAS_RE.test('atlases_longtime/mobile/abode/atlas-0.png')).toBe(true);
    expect(ATLAS_RE.test('atlases_longtime/mobile/abode/chunk-manifest.json')).toBe(true);
    for (const bad of ['atlases_longtime/mobile/../../manifest.json', 'atlases_longtime/mobile/abode/secret.json', 'atlases/mobile/../manifest.json', 'manifest.json', 'atlases/web/atlas-0.png', 'atlases/mobile/atlas-x.png']) expect(ATLAS_RE.test(bad)).toBe(false);
  });
  it('KILN_PAGE_COUNT equals the pages on disk', () => {
    const dir = join(GAME, '../assets/atlases/mobile');
    const pages = readdirSync(dir).filter((f) => /^atlas-\d+\.json$/.test(f));
    expect(pages.length).toBe(KILN_PAGE_COUNT);
  });
});

describe('manifest', () => {
  const m = JSON.parse(readFileSync(join(GAME, 'public/manifest.webmanifest'), 'utf8')) as { orientation: string; display: string; icons: { src: string; sizes: string }[] };
  it('is landscape and every icon exists with the stated size', () => {
    expect(m.orientation).toBe('landscape');
    expect(['fullscreen', 'standalone']).toContain(m.display);
    for (const i of m.icons) {
      const f = join(GAME, 'public', i.src);
      expect(existsSync(f), i.src).toBe(true);
      const png = readFileSync(f);
      const w = png.readUInt32BE(16);
      expect(`${w}x${png.readUInt32BE(20)}`).toBe(i.sizes);
    }
  });
});
