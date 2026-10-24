// Small DSP toolkit: RBJ biquads, one-poles, helpers. All processing in Float64.

export function biquadCoefs(type, f, q, gainDb, fs) {
  const w = (2 * Math.PI * Math.min(f, fs * 0.49)) / fs;
  const cw = Math.cos(w), sw = Math.sin(w);
  const A = 10 ** (gainDb / 40);
  const alpha = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lowpass':
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'highpass':
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'bandpass': // constant 0 dB peak gain
      b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'peak':
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
      a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
      a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break;
    }
    default: throw new Error('unknown biquad ' + type);
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

// In-place transposed direct form II.
export function applyBiquad(c, x) {
  const { b0, b1, b2, a1, a2 } = c;
  let s1 = 0, s2 = 0;
  for (let i = 0, n = x.length; i < n; i++) {
    const xi = x[i];
    const y = b0 * xi + s1;
    s1 = b1 * xi - a1 * y + s2;
    s2 = b2 * xi - a2 * y;
    x[i] = y;
  }
  return x;
}

export function applyChain(chain, x) {
  for (const c of chain) applyBiquad(c, x);
  return x;
}

// One-pole DC blocker / gentle high-pass, in place.
export function dcBlock(x, fc, fs) {
  const R = Math.exp((-2 * Math.PI * fc) / fs);
  let xp = 0, yp = 0;
  for (let i = 0, n = x.length; i < n; i++) {
    const xi = x[i];
    const y = xi - xp + R * yp;
    xp = xi; yp = y; x[i] = y;
  }
  return x;
}

export const dbToLin = (db) => 10 ** (db / 20);
export const linToDb = (x) => 20 * Math.log10(Math.max(x, 1e-30));

// Standard A-weighting in dB.
export function aWeightDb(f) {
  const f2 = f * f;
  const ra = (12194 ** 2 * f2 * f2) /
    ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return 20 * Math.log10(ra) + 2.0;
}

// Monotone piecewise-cubic (Fritsch–Carlson) interpolator over [[x, y], ...].
export function pchip(points) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const n = xs.length;
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  const m = new Array(n);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}
