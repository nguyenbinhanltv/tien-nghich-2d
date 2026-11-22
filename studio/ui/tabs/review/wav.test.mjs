import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWav, peaks } from './wav.mjs';
import { flatten } from './audio.mjs';

function wav({rate = 8000, channels = 1, samples}) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(channels, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * channels * 2, 28); head.writeUInt16LE(channels * 2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

test('peaks follow the signal envelope', () => {
  const loud = Array.from({length: 400}, (_, i) => (i < 200 ? 0 : (i % 2 ? 30000 : -30000)));
  const p = peaks(wav({samples: loud}), 4);
  assert.equal(p.min.length, 4);
  assert.ok(p.max[0] < 0.01 && p.max[3] > 0.9 && p.min[3] < -0.9);
  assert.equal(p.sampleRate, 8000);
  assert.equal(p.durationSeconds, 400 / 8000);
});

test('stereo is mixed, odd chunks are skipped, junk is refused with a reason', () => {
  const p = peaks(wav({channels: 2, samples: [16384, -16384, 16384, -16384]}), 2);
  assert.ok(Math.abs(p.max[0]) < 1e-9);
  assert.throws(() => parseWav(Buffer.from('not a wav file at all, definitely not, no way at all!!')), /RIFF/);
  const bad = wav({samples: [0, 0]}); bad.writeUInt16LE(8, 34);
  assert.throws(() => parseWav(bad), /unsupported/);
});

test('measurement rows: scalars and short lists, no long prose', () => {
  const rows = flatten({integrated_lufs: -23.2, meter: 'ffmpeg', note: 'x'.repeat(300), sample_peak: [-7.4, -9.7], nested: {ok: true, deep: {a: 1}}});
  assert.deepEqual(rows.map(r => r[0]), ['Integrated lufs', 'Meter', 'Sample peak', 'Nested · Ok', 'Nested · Deep · A']);
  assert.equal(rows[2][1], '-7.4, -9.7');
});

test('measurements that are not an object (a string or a list) give no rows instead of one row per character', () => {
  assert.deepEqual(flatten('master.wav'), []);
  assert.deepEqual(flatten(['a', 'b']), []);
  assert.deepEqual(flatten(null), []);
});
