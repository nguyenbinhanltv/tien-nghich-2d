// Direction table built with + - * / only (no Math.sin/cos: their last bit may differ between engines).
export const DIRS = 64;
export const COS = new Float64Array(DIRS);
export const SIN = new Float64Array(DIRS);
(function build() {
  const TAU = 6.283185307179586;
  for (let i = 0; i < DIRS; i++) {
    const a = ((i / DIRS) * TAU) % TAU;
    // reduce to [-pi, pi] then Taylor series to 13 terms: error < 1e-15
    const x = a > 3.141592653589793 ? a - TAU : a;
    let s = 0;
    let c = 0;
    let ts = x;
    let tc = 1;
    for (let n = 1; n < 28; n += 2) {
      s += ts;
      c += tc;
      tc = (-tc * x * x) / (n * (n + 1));
      ts = (-ts * x * x) / ((n + 1) * (n + 2));
    }
    COS[i] = c;
    SIN[i] = s;
  }
})();
