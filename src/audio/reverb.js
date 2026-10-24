// Concert-hall reverb: stereo early-reflection tap set + input diffusers + 16-line FDN
// (Hadamard feedback, per-line one-pole absorption for frequency-dependent T60, slow
// modulated delays against metallic ringing, decorrelated stereo outputs).
import { biquadCoefs, applyBiquad } from './dsp.js';
import { mulberry32 } from './rng.js';

const FDN_LEN_48K = [1499, 1637, 1789, 1951, 2129, 2297, 2477, 2659, 2851, 3061, 3271, 3491, 3727, 3967, 4229, 4493];
const AP_L_48K = [197, 283, 401, 557], AP_R_48K = [211, 307, 431, 587];
const MOD_LINES = [1, 4, 7, 10, 13], MOD_RATES = [0.13, 0.29, 0.41, 0.57, 0.71];

function onePoleLP(x, fc, fs) {
  const a = Math.exp((-2 * Math.PI * fc) / fs), b = 1 - a;
  let y = 0;
  for (let i = 0; i < x.length; i++) { y = b * x[i] + a * y; x[i] = y; }
}

const parity = (x) => { let p = 0; while (x) { p ^= x & 1; x >>= 1; } return p; };

// Raw (uncalibrated) reverb: returns early and late stereo components separately.
function reverbRaw(inL, inR, fs, P) {
  const n = inL.length, sc = fs / 48000;
  const t60Low = P.t60Low ?? 2.6, t60High = P.t60High ?? 0.5;
  const xL = Float64Array.from(inL), xR = Float64Array.from(inR);
  for (const c of [biquadCoefs('highpass', 45, 0.7, 0, fs), biquadCoefs('lowpass', 9500, 0.6, 0, fs)]) {
    applyBiquad(c, xL); applyBiquad(c, xR);
  }

  // ---- early reflections (7–85 ms), each side fed partly from the opposite channel
  const erL = new Float64Array(n), erR = new Float64Array(n);
  const rng = mulberry32(0x4a11);
  const NT = 24;
  for (let ch = 0; ch < 2; ch++) {
    const out = ch ? erR : erL, own = ch ? xR : xL, oth = ch ? xL : xR;
    for (let i = 0; i < NT; i++) {
      const tms = 7 + 78 * ((i + rng()) / NT) ** 1.3;
      const d = Math.round((tms * fs) / 1000);
      const g = Math.exp(-tms / 40) * (0.55 + 0.45 * rng()) * (rng() < 0.5 ? -1 : 1);
      const mix = 0.2 + 0.45 * rng();
      const go = g * (1 - mix), gx = g * mix;
      for (let k = d; k < n; k++) out[k] += go * own[k - d] + gx * oth[k - d];
    }
  }
  onePoleLP(erL, 6000, fs); onePoleLP(erR, 6000, fs);

  // ---- late reverb
  const NL = 16;
  const len = FDN_LEN_48K.map((l) => Math.round(l * sc));
  const LMAX = 1 << Math.ceil(Math.log2(Math.max(...len) + 64)), MASK = LMAX - 1;
  const lines = Array.from({ length: NL }, () => new Float64Array(LMAX));
  const b0 = new Float64Array(NL), fa1 = new Float64Array(NL), st = new Float64Array(NL), v = new Float64Array(NL);
  for (let i = 0; i < NL; i++) {
    const gdc = 10 ** ((-3 * len[i]) / (fs * t60Low)), gny = 10 ** ((-3 * len[i]) / (fs * t60High));
    const a = (gdc - gny) / (gdc + gny);
    fa1[i] = a; b0[i] = gdc * (1 - a);
  }
  const md = new Float64Array(NL), lc = new Float64Array(NL), ls = new Float64Array(NL), rc = new Float64Array(NL), rs = new Float64Array(NL);
  MOD_LINES.forEach((li, k) => {
    md[li] = 7 * sc;
    const w = (2 * Math.PI * MOD_RATES[k]) / fs, ph = 2 * Math.PI * rng();
    rc[li] = Math.cos(w); rs[li] = Math.sin(w); lc[li] = Math.cos(ph); ls[li] = Math.sin(ph);
  });
  const sL = new Float64Array(NL), sR = new Float64Array(NL), oL = new Float64Array(NL), oR = new Float64Array(NL);
  for (let i = 0; i < NL; i++) {
    sL[i] = rng() < 0.5 ? -0.5 : 0.5; sR[i] = rng() < 0.5 ? -0.5 : 0.5;
    oL[i] = parity(i & 3) ? -0.25 : 0.25; oR[i] = parity(i & 12) ? -0.25 : 0.25;
  }
  const apLen = [...AP_L_48K, ...AP_R_48K].map((l) => Math.round(l * sc));
  const apBuf = apLen.map((l) => new Float64Array(l)), apPos = new Int32Array(8);
  const g = 0.62;
  const pd = Math.round((P.preDelay ?? 0.022) * fs);
  const lateL = new Float64Array(n), lateR = new Float64Array(n);
  let w = 0, tiny = 1e-20;

  for (let t = 0; t < n; t++) {
    const si = t - pd;
    let a = si >= 0 ? xL[si] : 0, b = si >= 0 ? xR[si] : 0;
    for (let j = 0; j < 4; j++) {
      const bf = apBuf[j], p = apPos[j], dv = bf[p], ww = a + g * dv;
      a = dv - g * ww; bf[p] = ww; apPos[j] = p + 1 === apLen[j] ? 0 : p + 1;
    }
    for (let j = 4; j < 8; j++) {
      const bf = apBuf[j], p = apPos[j], dv = bf[p], ww = b + g * dv;
      b = dv - g * ww; bf[p] = ww; apPos[j] = p + 1 === apLen[j] ? 0 : p + 1;
    }
    let outL = 0, outR = 0;
    for (let i = 0; i < NL; i++) {
      const buf = lines[i];
      let o;
      if (md[i] > 0) {
        const c = lc[i], s = ls[i];
        const nc = c * rc[i] - s * rs[i], ns = c * rs[i] + s * rc[i];
        lc[i] = nc; ls[i] = ns;
        const pos = w - (len[i] - md[i] * (1 + ns));
        const ip = Math.floor(pos), fr = pos - ip;
        const ym1 = buf[(ip - 1) & MASK], y0 = buf[ip & MASK], y1 = buf[(ip + 1) & MASK], y2 = buf[(ip + 2) & MASK];
        // 4-point, 3rd-order Lagrange
        const c0 = -fr * (fr - 1) * (fr - 2) / 6, c1 = (fr + 1) * (fr - 1) * (fr - 2) / 2;
        const c2 = -(fr + 1) * fr * (fr - 2) / 2, c3 = (fr + 1) * fr * (fr - 1) / 6;
        o = c0 * ym1 + c1 * y0 + c2 * y1 + c3 * y2;
      } else {
        o = buf[(w - len[i]) & MASK];
      }
      const y = b0[i] * o + fa1[i] * st[i];
      st[i] = y; v[i] = y;
      outL += oL[i] * y; outR += oR[i] * y;
    }
    // fast Walsh–Hadamard (orthogonal after ×1/4)
    for (let h = 1; h < NL; h <<= 1) {
      for (let i = 0; i < NL; i += h << 1) {
        for (let j = i; j < i + h; j++) { const x = v[j], y = v[j + h]; v[j] = x + y; v[j + h] = x - y; }
      }
    }
    tiny = -tiny; // denormal guard
    for (let i = 0; i < NL; i++) lines[i][w] = 0.25 * v[i] + sL[i] * a + sR[i] * b + tiny;
    w = (w + 1) & MASK;
    lateL[t] = outL; lateR[t] = outR;
    if ((t & 4095) === 0) {
      for (const li of MOD_LINES) { const r = 1 / Math.hypot(lc[li], ls[li]); lc[li] *= r; ls[li] *= r; }
    }
  }
  return { erL, erR, lateL, lateR };
}

const calCache = new Map();
// Calibrate ER/late energy against a piano-like (low-passed) impulse, so wet levels are in dB re dry.
function calibrate(fs, P) {
  const key = JSON.stringify([fs, P.t60Low, P.t60High, P.preDelay]);
  if (calCache.has(key)) return calCache.get(key);
  const n = Math.round(fs * 4.5);
  const x = new Float64Array(n);
  x[0] = 1;
  onePoleLP(x, 1000, fs);
  let ex = 0;
  for (let i = 0; i < n; i++) ex += x[i] * x[i];
  const r = reverbRaw(x, x, fs, P);
  let eE = 0, eL = 0;
  for (let i = 0; i < n; i++) { eE += r.erL[i] ** 2 + r.erR[i] ** 2; eL += r.lateL[i] ** 2 + r.lateR[i] ** 2; }
  const cal = { er: Math.sqrt((2 * ex) / eE), late: Math.sqrt((2 * ex) / eL) };
  calCache.set(key, cal);
  return cal;
}

// Returns wet stereo signal with ER at erDb and late reverb at lateDb (energy re the dry input).
export function hallReverb(inL, inR, fs, P = {}) {
  const cal = calibrate(fs, P);
  const r = reverbRaw(inL, inR, fs, P);
  const gE = cal.er * 10 ** ((P.erDb ?? -8) / 20), gLt = cal.late * 10 ** ((P.lateDb ?? -5) / 20);
  const wL = r.erL, wR = r.erR;
  for (let i = 0; i < wL.length; i++) {
    wL[i] = gE * wL[i] + gLt * r.lateL[i];
    wR[i] = gE * wR[i] + gLt * r.lateR[i];
  }
  return { wetL: wL, wetR: wR };
}
