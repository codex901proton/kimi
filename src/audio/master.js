// Mastering: DC block, warmth shelf, glue compression, look-ahead limiter, soft clip,
// true-peak normalization, edge fades. Also level/true-peak measurement helpers.
import { biquadCoefs, applyBiquad, dcBlock, linToDb } from './dsp.js';

// 4× oversampled peak estimate (windowed-sinc interpolation, evaluated near large samples).
export function truePeak(L, R) {
  const TAPS = 16, PH = 4;
  const kern = [];
  for (let p = 1; p < PH; p++) {
    const fr = p / PH, k = new Float64Array(2 * TAPS);
    for (let j = -TAPS + 1; j <= TAPS; j++) {
      const x = j - fr;
      const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const wv = 0.42 + 0.5 * Math.cos((Math.PI * x) / TAPS) + 0.08 * Math.cos((2 * Math.PI * x) / TAPS); // Blackman
      k[j + TAPS - 1] = sinc * wv;
    }
    kern.push(k);
  }
  let sp = 0;
  for (const ch of [L, R]) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > sp) sp = a; }
  let tp = sp;
  const thr = 0.5 * sp;
  for (const ch of [L, R]) {
    const n = ch.length;
    for (let i = TAPS; i < n - TAPS; i++) {
      if (Math.abs(ch[i]) < thr && Math.abs(ch[i + 1]) < thr) continue;
      for (const k of kern) {
        let s = 0;
        for (let j = 0; j < 2 * TAPS; j++) s += k[j] * ch[i - TAPS + 1 + j];
        const a = Math.abs(s);
        if (a > tp) tp = a;
      }
    }
  }
  return { samplePeak: sp, truePeak: tp };
}

// Short-term (400 ms, 100 ms hop) RMS levels in dB of mono power.
export function shortTermLevels(L, R, fs, win = 0.4, hop = 0.1) {
  const W = Math.round(win * fs), H = Math.round(hop * fs), out = [];
  for (let s = 0; s + W <= L.length; s += H) {
    let e = 0;
    for (let i = s; i < s + W; i++) e += 0.5 * (L[i] * L[i] + R[i] * R[i]);
    out.push(10 * Math.log10(e / W + 1e-30));
  }
  return out;
}

export function rmsDb(L, R) {
  let e = 0;
  for (let i = 0; i < L.length; i++) e += 0.5 * (L[i] * L[i] + R[i] * R[i]);
  return 10 * Math.log10(e / Math.max(1, L.length) + 1e-30);
}

const pct = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

function compress(L, R, fs, thrDb, ratio, kneeDb, attS, relS, rmsS) {
  const cR = 1 - Math.exp(-1 / (rmsS * fs)), cA = 1 - Math.exp(-1 / (attS * fs)), cRl = 1 - Math.exp(-1 / (relS * fs));
  let p = 0, g = 0, maxGr = 0;
  const slope = 1 / ratio - 1;
  for (let i = 0; i < L.length; i++) {
    p += (0.5 * (L[i] * L[i] + R[i] * R[i]) - p) * cR;
    const lvl = 10 * Math.log10(p + 1e-30);
    const over = lvl - thrDb;
    let gr;
    if (2 * over < -kneeDb) gr = 0;
    else if (2 * Math.abs(over) <= kneeDb) gr = (slope * (over + kneeDb / 2) ** 2) / (2 * kneeDb);
    else gr = slope * over;
    g += (gr - g) * (gr < g ? cA : cRl);
    if (-g > maxGr) maxGr = -g;
    const lin = 10 ** (g / 20);
    L[i] *= lin; R[i] *= lin;
  }
  return maxGr;
}

// Look-ahead peak limiter: sliding-window minimum of required gain → release → moving average.
function limit(L, R, fs, ceil, lookS = 0.0025, relS = 0.12) {
  const n = L.length, La = Math.max(1, Math.round(lookS * fs));
  const req = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    req[i] = a > ceil ? ceil / a : 1;
  }
  // e[k] = min(req[k-La..k]) via monotone deque
  const e = new Float64Array(n), dq = new Int32Array(n);
  let h = 0, t = 0;
  for (let k = 0; k < n; k++) {
    while (t > h && req[dq[t - 1]] >= req[k]) t--;
    dq[t++] = k;
    if (dq[h] < k - La) h++;
    e[k] = req[dq[h]];
  }
  const cRel = 1 - Math.exp(-1 / (relS * fs));
  let r = 1;
  for (let k = 0; k < n; k++) { r = e[k] < r ? e[k] : r + (e[k] - r) * cRel; e[k] = r; }
  // moving average over La+1 samples, audio delayed by La
  let acc = 0, minG = 1;
  const g = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    acc += e[k];
    if (k > La) acc -= e[k - La - 1];
    g[k] = acc / Math.min(k + 1, La + 1);
  }
  const oL = new Float64Array(n), oR = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const src = k - La;
    const xl = src >= 0 ? L[src] : 0, xr = src >= 0 ? R[src] : 0;
    oL[k] = xl * g[k]; oR[k] = xr * g[k];
    if (g[k] < minG) minG = g[k];
  }
  // compensate the look-ahead latency
  L.set(oL.subarray(La)); L.fill(0, n - La);
  R.set(oR.subarray(La)); R.fill(0, n - La);
  return -linToDb(minG);
}

function softClip(x, t = 0.94) {
  let n = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > t) { x[i] = Math.sign(x[i]) * (t + (1 - t) * Math.tanh((a - t) / (1 - t))); n++; }
  }
  return n;
}

export function masterChain(L, R, fs, o = {}) {
  const st = {};
  dcBlock(L, 6, fs); dcBlock(R, 6, fs);
  const ls = biquadCoefs('lowshelf', 150, 0.7, o.warmthDb ?? 1.5, fs);
  applyBiquad(ls, L); applyBiquad(ls, R);

  // reference level: peak → 0 dBFS
  let pk = 0;
  for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const g0 = pk > 0 ? 1 / pk : 1;
  for (let i = 0; i < L.length; i++) { L[i] *= g0; R[i] *= g0; }

  const lv = shortTermLevels(L, R, fs).filter((x) => x > -80);
  const loud = lv.length ? pct(lv, 0.95) : -20;
  st.preLevels = { p10: lv.length ? pct(lv, 0.1) : null, p50: lv.length ? pct(lv, 0.5) : null, p95: loud };
  const thr = loud - (o.compDepthDb ?? 14);
  st.compThresholdDb = thr;
  st.compMaxGrDb = compress(L, R, fs, thr, o.ratio ?? 2, o.kneeDb ?? 10, o.attack ?? 0.03, o.release ?? 0.4, 0.015);

  // make-up toward target RMS, bounded so the limiter never works harder than maxLimitDb
  const target = o.targetRmsDb ?? -16;
  const rms = rmsDb(L, R);
  let p2 = 0;
  for (let i = 0; i < L.length; i++) p2 = Math.max(p2, Math.abs(L[i]), Math.abs(R[i]));
  const ceilDb = -1.3;
  let gain = target - rms;
  const maxLim = o.maxLimitDb ?? 5;
  if (linToDb(p2) + gain - ceilDb > maxLim) gain = maxLim + ceilDb - linToDb(p2);
  const gl = 10 ** (gain / 20);
  for (let i = 0; i < L.length; i++) { L[i] *= gl; R[i] *= gl; }
  st.makeupDb = gain;
  st.limiterMaxGrDb = limit(L, R, fs, 10 ** (ceilDb / 20));
  st.softClipped = softClip(L) + softClip(R);

  // true-peak normalize to −1 dBFS
  const tp = truePeak(L, R);
  const gn = 10 ** (-1 / 20) / tp.truePeak;
  for (let i = 0; i < L.length; i++) { L[i] *= gn; R[i] *= gn; }
  // edge fades
  const fi = Math.min(L.length, Math.round(0.002 * fs)), fo = Math.min(L.length, Math.round(0.03 * fs));
  for (let i = 0; i < fi; i++) { const e = i / fi; L[i] *= e; R[i] *= e; }
  for (let i = 0; i < fo; i++) { const k = L.length - 1 - i, e = i / fo; L[k] *= e; R[k] *= e; }
  return st;
}
