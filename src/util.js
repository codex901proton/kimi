// Shared math helpers and deterministic randomness.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
// Minimum-jerk profile (Flash & Hogan): natural human reaching motion.
export const minjerk = (t) => { t = clamp(t); return t * t * t * (10 + t * (-15 + 6 * t)); };
export const easeInQuad = (t) => { t = clamp(t); return t * t; };
export const easeOutCubic = (t) => { t = clamp(t); return 1 - (1 - t) ** 3; };
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Smooth 1-D value noise (deterministic), roughly in [-1, 1].
export function noise1(x, seed = 0) {
  const h = (i) => {
    let n = (i * 374761393 + seed * 668265263) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 2147483648 - 1;
  };
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

export function fbm1(x, seed = 0, oct = 3) {
  let s = 0, a = 0.5, f = 1;
  for (let o = 0; o < oct; o++) { s += a * noise1(x * f, seed + o * 17); a *= 0.5; f *= 2; }
  return s;
}

export function lowerBound(arr, x, key = (v) => v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (key(arr[m]) < x) lo = m + 1; else hi = m; }
  return lo;
}
