// A small ZIP reader and writer (stored and deflate entries) for the .pxo container. Deterministic: the same entries give the
// same bytes (fixed timestamp, no extra fields). The reader is bounded: entry count, per-entry and total output size are capped,
// so a hostile archive cannot exhaust memory, and names that could escape a directory are refused.
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export const ZIP_LIMITS = Object.freeze({entries: 4096, entryBytes: 8 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, fileBytes: 32 * 1024 * 1024});
const DOS_TIME = 0, DOS_DATE = (1 << 5) | 1; // 1980-01-01 00:00

/** entries: [{name, data: Buffer, store?: boolean}] -> Buffer. */
export function writeZip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), data = Buffer.from(e.data);
    const packed = e.store || !data.length ? data : deflateRawSync(data, {level: 9});
    const method = packed === data ? 0 : 8, crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(method, 8);
    head.writeUInt16LE(DOS_TIME, 10); head.writeUInt16LE(DOS_DATE, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(name.length, 26);
    locals.push(head, name, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(method, 10);
    c.writeUInt16LE(DOS_TIME, 12); c.writeUInt16LE(DOS_DATE, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + packed.length;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

const bad = message => { throw Object.assign(new Error(message), {status: 422, code: 'invalid_input'}); };

/** Buffer -> Map name -> Buffer. Refuses what it cannot read with a reason. */
export function readZip(buf) {
  if (buf.length < 22 || buf.length > ZIP_LIMITS.fileBytes) bad(`the file is not a readable ZIP (${buf.length} bytes)`);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) bad('the file is not a ZIP archive (no end record)');
  const count = buf.readUInt16LE(end + 10), cdOffset = buf.readUInt32LE(end + 16);
  if (count > ZIP_LIMITS.entries) bad(`the archive has ${count} entries; the limit is ${ZIP_LIMITS.entries}`);
  const out = new Map();
  let pos = cdOffset, total = 0;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) bad('the ZIP directory is damaged');
    const flags = buf.readUInt16LE(pos + 8), method = buf.readUInt16LE(pos + 10), crc = buf.readUInt32LE(pos + 16);
    const csize = buf.readUInt32LE(pos + 20), size = buf.readUInt32LE(pos + 24);
    const nlen = buf.readUInt16LE(pos + 28), xlen = buf.readUInt16LE(pos + 30), clen = buf.readUInt16LE(pos + 32), lho = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nlen);
    pos += 46 + nlen + xlen + clen;
    if (flags & 1) bad(`${name} is encrypted`);
    if (name.endsWith('/')) continue;
    if (name.startsWith('/') || name.split('/').includes('..') || name.includes('\\')) bad(`the archive has an unsafe entry name "${name}"`);
    if (size > ZIP_LIMITS.entryBytes) bad(`${name} is ${size} bytes unpacked; the limit is ${ZIP_LIMITS.entryBytes}`);
    total += size;
    if (total > ZIP_LIMITS.totalBytes) bad('the archive unpacks to too many bytes');
    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) bad(`${name} has a damaged header`);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    if (start + csize > buf.length) bad(`${name} is cut short`);
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) { try { data = inflateRawSync(raw, {maxOutputLength: size + 1}); } catch { bad(`${name} does not unpack`); } }
    else bad(`${name} uses compression method ${method}, which is not supported`);
    if (data.length !== size || crc32(data) !== crc) bad(`${name} fails its checksum`);
    if (out.has(name)) bad(`the archive lists ${name} twice`);
    out.set(name, data);
  }
  return out;
}
