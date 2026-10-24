// Per-key damper contact D(t) in [0,1] at block resolution (0 = lifted, 1 = fully on the string),
// from key-held intervals and the sustain-pedal curve. Shared with workers via SharedArrayBuffer.
import { KEY_LO, NKEYS, NO_DAMPER_FROM } from './piano-model.js';

export function pedalValueFn(pedal) {
  const pts = (pedal || []).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .map((p) => ({ t: p.t, v: Math.max(0, Math.min(1, p.v)) })).sort((a, b) => a.t - b.t);
  let j = 0;
  // Monotone-time evaluator (call with non-decreasing t for O(1) amortized).
  return (t) => {
    if (pts.length === 0) return 0;
    if (j > 0 && t < pts[j - 1].t) j = 0;
    while (j < pts.length && pts[j].t <= t) j++;
    if (j === 0) return 0;
    if (j === pts.length) return pts[pts.length - 1].v;
    const a = pts[j - 1], b = pts[j];
    return a.v + ((b.v - a.v) * (t - a.t)) / Math.max(1e-9, b.t - a.t);
  };
}

// Pedal value → damper engagement. Fully lifted above ~0.62, fully down below ~0.22, partial between.
export function engagement(v) {
  if (v >= 0.62) return 0;
  if (v <= 0.22) return 1;
  const x = (0.62 - v) / 0.4;
  return x * x * (3 - 2 * x);
}

export function buildDamperTable(notes, pedal, fs, BLK, total) {
  const nB = Math.ceil(total / BLK) + 4;
  const sab = new SharedArrayBuffer(NKEYS * nB * 4);
  const D = new Float32Array(sab);
  const pv = pedalValueFn(pedal);
  const eng = new Float32Array(nB), pedalV = new Float32Array(nB);
  for (let b = 0; b < nB; b++) {
    const v = pv((b * BLK + BLK / 2) / fs);
    pedalV[b] = v;
    eng[b] = engagement(v);
  }
  const held = Array.from({ length: NKEYS }, () => []);
  for (const n of notes) {
    const k = n.midi - KEY_LO;
    if (k < 0 || k >= NKEYS) continue;
    // damper lifts just before the strike and lands ~8 ms after the key starts rising
    held[k].push([n.on - 0.02, Math.max(n.off, n.on + 0.03) + 0.008]);
  }
  const cFall = 1 - Math.exp(-BLK / (fs * 0.012));
  const cLift = 1 - Math.exp(-BLK / (fs * 0.004));
  const mark = new Uint8Array(nB);
  for (let k = 0; k < NKEYS; k++) {
    const m = k + KEY_LO, off = k * nB;
    if (m >= NO_DAMPER_FROM) continue; // stays 0
    mark.fill(0);
    for (const [a, b] of held[k]) {
      const b0 = Math.max(0, Math.floor((a * fs) / BLK)), b1 = Math.min(nB - 1, Math.floor((b * fs) / BLK));
      for (let i = b0; i <= b1; i++) mark[i] = 1;
    }
    let d = 1;
    for (let b = 0; b < nB; b++) {
      const target = mark[b] ? 0 : eng[b];
      d += (target - d) * (target > d ? cFall : cLift);
      if (Math.abs(target - d) < 2e-3) d = target; // snap so coefficients stop changing
      D[off + b] = d;
    }
  }
  return { sab, D, nB, pedalV };
}
