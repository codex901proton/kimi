// Physically-informed concert-grand model: per-key string data (tuning, inharmonicity,
// unisons, decay, damping), hammer spectrum, attack thump and sympathetic coupling tables.
import { mulberry32, hashSeed } from './rng.js';
import { pchip, aWeightDb } from './dsp.js';

export const KEY_LO = 21, KEY_HI = 108, NKEYS = 88;
export const NO_DAMPER_FROM = 90; // keys above F6 (MIDI 89) have no dampers
export const VREF = 0.6; // velocity at which per-key loudness is normalized
export const NOTE_SCALE = 0.08; // absolute amplitude scale of a note at VREF
export const LOUD_EXP = 2.2; // amplitude ∝ vel^LOUD_EXP (spectral brightening adds on top)
export const SPLIT_HZ = 130; // partials below this stay centred (mono-compatible bass)

// Railsback stretch in cents (concert-grand aural tuning).
const stretchCents = pchip([[21, -12], [24, -10.3], [28, -8.1], [33, -5.9], [36, -4.8], [40, -3.6], [45, -2.4],
  [48, -1.8], [52, -1.15], [57, -0.6], [60, -0.35], [64, -0.12], [69, 0], [72, 0.35], [76, 1.0], [81, 2.1],
  [84, 3.0], [88, 4.6], [93, 7.4], [96, 9.6], [100, 13.4], [104, 18.6], [108, 25]]);

// Inharmonicity coefficient B (log10-interpolated): wound bass strings low, rising sharply in the treble.
const log10B = pchip([[21, 2.6e-4], [26, 1.85e-4], [31, 1.3e-4], [36, 1.0e-4], [41, 1.05e-4], [46, 1.5e-4],
  [52, 2.3e-4], [57, 3.0e-4], [60, 3.6e-4], [64, 4.6e-4], [69, 6.2e-4], [72, 7.6e-4], [76, 1.05e-3],
  [81, 1.6e-3], [84, 2.1e-3], [88, 3.0e-3], [93, 4.6e-3], [96, 5.8e-3], [100, 7.6e-3], [104, 9.8e-3],
  [108, 1.25e-2]].map(([m, b]) => [m, Math.log10(b)]));

// Undamped T60 (s) of the fundamental's aftersound.
const log10T60 = pchip([[21, 25], [24, 24], [30, 21.5], [36, 19], [42, 17], [48, 15], [54, 12.5], [60, 10],
  [66, 8.4], [72, 7], [78, 5.4], [84, 4], [90, 2.8], [96, 1.9], [102, 1.35], [108, 1.0]]
  .map(([m, t]) => [m, Math.log10(t)]));

// Damper T60 (s) for the fundamental once the felt is on the string.
const log10Td = pchip([[21, 0.55], [30, 0.45], [36, 0.38], [42, 0.3], [48, 0.24], [54, 0.19], [60, 0.155],
  [66, 0.13], [72, 0.11], [78, 0.09], [84, 0.08], [89, 0.07], [108, 0.07]].map(([m, t]) => [m, Math.log10(t)]));

const strikeBeta = pchip([[21, 0.122], [40, 0.12], [60, 0.117], [72, 0.112], [84, 0.1], [96, 0.085], [108, 0.07]]);
const promptRatio = pchip([[21, 2.4], [48, 2.6], [72, 2.5], [84, 2.0], [96, 1.7], [108, 1.4]]);
const regGainDb = pchip([[21, 1.5], [40, 1.0], [60, 0], [84, -0.5], [96, -1.5], [108, -3]]);
const knockHz = pchip([[21, 110], [48, 220], [72, 600], [96, 1100], [108, 1400]]);

// Shared soundboard "fingerprint": smooth ±dB resonances common to every string.
const SB_PEAKS = (() => {
  const r = mulberry32(0xb0a7d);
  const lo = Math.log2(55), hi = Math.log2(9000), out = [];
  for (let i = 0; i < 48; i++) out.push([lo + ((hi - lo) * (i + r())) / 48, (r() - 0.5) * 3.2, 0.08 + 0.1 * r()]);
  return out;
})();
export function soundboardDb(f) {
  const lf = Math.log2(f);
  let s = 0;
  for (const [c, g, w] of SB_PEAKS) { const d = (lf - c) / w; s += g * Math.exp(-d * d); }
  const lb = Math.log2(f / 330);
  return s + 20 * Math.log10(1 + 0.35 * Math.exp((-lb * lb) / 2)); // broad body bump around 330 Hz
}

const hLoss = (f) => (f / 3000) ** 1.5 / 1.2; // frequency-dependent string loss (1/T60 units)

export function buildKeyModel(m, fs) {
  const r = mulberry32(hashSeed(0x9a1170, m));
  const fET = 440 * 2 ** ((m - 69) / 12);
  const f1 = fET * 2 ** (stretchCents(m) / 1200);
  const B = 10 ** log10B(m);
  const F = f1 / Math.sqrt(1 + B);
  const S = m <= 26 ? 1 : m <= 44 ? 2 : 3;

  // Unison mistuning (cents) and per-string inharmonicity spread; S=1 → two polarizations.
  const spread = 0.25 + 0.95 * r();
  let cents;
  if (S === 3) {
    const a = spread * (0.35 + 0.3 * r()), b = -(spread - a);
    const c0 = (r() - 0.5) * 0.2 * spread;
    cents = [c0, a, b];
  } else if (S === 2) {
    cents = [-spread / 2, spread / 2];
  } else {
    cents = [0, (0.06 + 0.12 * r()) * (r() < 0.5 ? -1 : 1)];
  }
  const meanC = cents.reduce((s, x) => s + x, 0) / cents.length;
  cents = cents.map((c) => c - meanC);
  const bDev = cents.map(() => 1 + 0.012 * (2 * r() - 1));

  const fmax = Math.min(16000, 0.9 * fs * 0.5);
  const T60 = 10 ** log10T60(m), Td = 10 ** log10Td(m);
  const R0 = promptRatio(m);
  const phase2 = [], fArr = [], sf0 = [], sf1 = [], sf2 = [], sigSlow = [], sigFast = [], alpha = [], wsplit = [], sigDamp = [], ampJit = [], phase = [];
  for (let n = 1; n <= 100; n++) {
    const fn = n * F * Math.sqrt(1 + B * n * n);
    if (fn >= fmax) break;
    const sfreq = cents.map((c, k) => n * F * 2 ** (c / 1200) * Math.sqrt(1 + B * bDev[k] * n * n));
    fArr.push(fn);
    if (S === 1) { sf0.push(sfreq[0]); sf1.push(sfreq[1]); sf2.push(sfreq[1]); }
    else if (S === 2) { sf0.push(fn); sf1.push(sfreq[0]); sf2.push(sfreq[1]); }
    else { sf0.push((sfreq[0] + sfreq[1] + sfreq[2]) / 3); sf1.push(sfreq[1]); sf2.push(sfreq[2]); }
    const invT = 1 / T60 + hLoss(fn) - hLoss(f1);
    const sS = 6.91 * invT * (0.9 + 0.2 * r());
    const R = 1 + (R0 - 1) * Math.exp(-fn / 4000) * (0.8 + 0.4 * r());
    sigSlow.push(sS);
    sigFast.push(sS * R);
    alpha.push(Math.min(0.5, 0.24 + 0.18 * r() + (m < 40 ? 0.05 : 0)));
    wsplit.push(0.6 + 0.25 * r());
    phase2.push((r() - 0.5) * 2); // aftersound strings are not phase-locked to each other
    // damper: higher partials damp faster; random spread leaves a few "ghost" partials
    sigDamp.push((6.91 / Td) * (1 + 0.35 * (n - 1)) ** 0.6 * (0.6 + 0.8 * r()));
    ampJit.push(10 ** ((soundboardDb(fn) + 1.0 * (2 * r() - 1)) / 20));
    phase.push(2 * Math.PI * r());
  }
  const np = fArr.length;
  const x = (m - 64.5) / 43.5;
  const pan = 0.5 * x; // pianist's perspective: bass left, treble right
  const th = ((pan + 1) * Math.PI) / 4;
  const dly = Math.round(5 * Math.abs(x));
  const fcScale = Math.min(1.7, Math.max(0.42, (f1 / 261.6) ** 0.35));
  const tiltExp = 0.75 + 0.6 * Math.max(0, Math.min(1, (m - 60) / 48)); // treble spectra are fundamental-dominated
  const bassW = Math.max(0, Math.min(1, (84 - m) / 63));
  const km = {
    m, f1, F, B, S, cents, np, T60, Td,
    f: Float64Array.from(fArr), sf0: Float64Array.from(sf0), sf1: Float64Array.from(sf1), sf2: Float64Array.from(sf2),
    sigSlow: Float64Array.from(sigSlow), sigFast: Float64Array.from(sigFast), alpha: Float64Array.from(alpha),
    wsplit: Float64Array.from(wsplit), sigDamp: Float64Array.from(sigDamp), ampJit: Float64Array.from(ampJit),
    phase: Float64Array.from(phase), phase2: Float64Array.from(phase2),
    beta: strikeBeta(m) * (1 + (r() - 0.5) * 0.04),
    fcScale, tiltExp,
    gReg: 10 ** (regGainDb(m) / 20),
    gL: Math.cos(th), gR: Math.sin(th),
    dL: x > 0 ? dly : 0, dR: x < 0 ? dly : 0,
    noDamper: m >= NO_DAMPER_FROM,
    attackRegF: m < 48 ? 1.4 - (0.4 * (m - 21)) / 27 : m > 84 ? Math.max(0.6, 1 - (0.4 * (m - 84)) / 24) : 1,
    thump: {
      fk: knockHz(m) * (0.92 + 0.16 * r()), qk: 1.1, tauK: 0.0065 - 0.004 * (1 - bassW),
      fc: 3800 + 1400 * r(), qc: 0.8, tauC: 0.0009,
      boardF: [58, 89, 127, 176, 241].map((f) => f * (0.95 + 0.1 * r())),
      boardT60: [0.2, 0.16, 0.13, 0.11, 0.09].map((t) => t * (0.8 + 0.4 * r())),
      boardW: [0, 0, 0, 0, 0].map(() => (0.35 + 0.65 * r()) * (0.08 + 0.92 * bassW * bassW)),
      wK: 0.45 + 0.55 * bassW,
    },
    fL: m < 65 ? 1250 * 2 ** ((m - 21) / 36) : 0, // longitudinal-mode region for phantom partials
    phantomW: m < 65 ? (65 - m) / 44 : 0,
    symp: [],
    K: 1,
  };
  // Per-key loudness normalization at VREF with a half-strength A-weighting.
  const a = new Float64Array(np);
  partialAmps(km, VREF, a);
  let e = 0;
  for (let p = 0; p < np; p++) e += a[p] * a[p] * 10 ** ((0.5 * aWeightDb(km.f[p])) / 10);
  km.K = 1 / Math.sqrt(e);
  return km;
}

// Hammer/strike spectrum (relative partial amplitudes) at velocity v.
export function partialAmps(km, v, out) {
  const fc = 700 * 10 ** (1.05 * v) * km.fcScale; // felt hardens with velocity: ~1 kHz pp → ~5.6 kHz fff, 7.8 kHz sffff (C4)
  const beta = km.beta, te = km.tiltExp;
  for (let p = 0; p < km.np; p++) {
    const n = p + 1, f = km.f[p];
    const comb = 0.15 + 0.85 * Math.abs(Math.sin(Math.PI * n * beta));
    const x = f / fc, x4 = (x / 4) ** 4;
    const lp = 1 / (1 + x * x) / Math.sqrt(1 + x4);
    const q = 95 / f, rad = 1 / Math.sqrt(1 + q * q * q * q); // weak radiation of the lowest fundamentals
    out[p] = comb * n ** -te * lp * rad * km.ampJit[p];
  }
  return out;
}

// Sympathetic coupling: for each driver partial, strings whose partials coincide (octaves, fifths, ...).
function linkSympathetic(keys, kappaRef) {
  for (const d of keys) {
    const cands = [];
    for (let j = 0; j < Math.min(d.np, 12); j++) {
      const f = d.f[j];
      if (f > 5000) break;
      for (let mt = 1; mt <= 10; mt++) {
        const est = Math.round(69 + 12 * Math.log2(f / mt / 440));
        for (let t = est - 1; t <= est + 1; t++) {
          if (t < KEY_LO || t > KEY_HI || t === d.m) continue;
          const tk = keys[t - KEY_LO];
          if (mt - 1 >= tk.np) continue;
          const tf = tk.f[mt - 1], df = tf - f;
          if (Math.abs(df) > 3 || Math.abs(df) / f > 0.006) continue;
          const sameBridge = (d.m <= 40) === (t <= 40) ? 1 : 0.45;
          const prox = 0.6 + 0.4 * Math.exp(-Math.abs(d.m - t) / 24);
          const kbase = (sameBridge * prox * Math.sqrt(tk.S / 3)) / Math.sqrt(mt);
          const sig = tk.sigSlow[mt - 1];
          const rho = (kappaRef * kbase) / Math.hypot(sig, 2 * Math.PI * df);
          if (rho < 6e-3) continue;
          cands.push({ pid: j, tkey: t, tpid: mt - 1, tf, tSigU: sig, tSigD: tk.noDamper ? 0 : tk.sigDamp[mt - 1], kbase, rho });
        }
      }
    }
    cands.sort((a, b) => b.rho - a.rho);
    d.symp = cands.slice(0, 16);
  }
}

const cache = new Map();
export function buildAllKeys(fs, kappaRef = 0.25) {
  const ck = fs + ':' + kappaRef;
  if (cache.has(ck)) return cache.get(ck);
  const keys = [];
  for (let m = KEY_LO; m <= KEY_HI; m++) keys.push(buildKeyModel(m, fs));
  linkSympathetic(keys, kappaRef);
  cache.set(ck, keys);
  return keys;
}
