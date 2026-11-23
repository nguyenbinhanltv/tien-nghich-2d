// Two independent FNV-1a 32-bit lanes over raw bytes -> 16 hex chars.
export class Hasher {
  a = 0x811c9dc5;
  b = 0x9e3779b9;
  bytes(u8: Uint8Array): this {
    let a = this.a;
    let b = this.b;
    for (let i = 0; i < u8.length; i++) {
      const v = u8[i]!;
      a = Math.imul(a ^ v, 0x01000193);
      b = Math.imul(b ^ (v + 0x5b), 0x85ebca6b);
    }
    this.a = a >>> 0;
    this.b = b >>> 0;
    return this;
  }
  typed(t: ArrayBufferView): this {
    return this.bytes(new Uint8Array(t.buffer, t.byteOffset, t.byteLength));
  }
  u32(n: number): this {
    const t = new Uint32Array(1);
    t[0] = n >>> 0;
    return this.typed(t);
  }
  f64(n: number): this {
    const t = new Float64Array(1);
    t[0] = n;
    return this.typed(t);
  }
  hex(): string {
    return this.a.toString(16).padStart(8, "0") + this.b.toString(16).padStart(8, "0");
  }
}
