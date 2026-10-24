#!/usr/bin/env node
// Objective checks for a rendered WAV: peaks, RMS, short-term level distribution, NaN/clipping,
// click detection (isolated HF bursts and sample jumps), stereo/mono compatibility.
// Usage: node src/audio/analyze.js <file.wav> [perf.json with sections]
import { readFileSync } from 'node:fs';
import { readWav } from './wav.js';
import { truePeak, rmsDb, shortTermLevels } from './master.js';
import { biquadCoefs, applyBiquad } from './dsp.js';

export function detectClicks(x, fs, { win = 0.0005, ctx = 0.025, guard = 0.002, ratioDb = 12, floorDb = -85, hpHz = 15000 } = {}) {
  // Clicks are broadband; music has little energy above ~15 kHz → steep high-pass first.
  const n = x.length, W = Math.max(8, Math.round(win * fs)), H = W >> 1;
  const y = Float64Array.from(x);
  const hp = biquadCoefs('highpass', Math.min(hpHz, fs * 0.4), 0.7071, 0, fs);
  for (let k = 0; k < 3; k++) applyBiquad(hp, y);
  const nw = Math.floor((n - W) / H);
  const E = new Float64Array(Math.max(0, nw));
  for (let k = 0; k < nw; k++) {
    let e = 0;
    for (let i = k * H; i < k * H + W; i++) e += y[i] * y[i];
    E[k] = e / W;
  }
  const P = new Float64Array(nw + 1);
  for (let k = 0; k < nw; k++) P[k + 1] = P[k] + E[k];
  const C = Math.round(ctx * fs / H), G = Math.round(guard * fs / H);
  const ev = [];
  const lim = 10 ** (ratioDb / 10), fl = 10 ** (floorDb / 10);
  for (let k = C + G; k < nw - C - G; k++) {
    if (E[k] < fl) continue;
    const before = (P[k - G] - P[k - G - C]) / C, after = (P[k + G + 1 + C] - P[k + G + 1]) / C;
    const bg = Math.max(before, after, 1e-30);
    if (E[k] > lim * bg) ev.push({ t: +((k * H) / fs).toFixed(4), scoreDb: +(10 * Math.log10(E[k] / bg)).toFixed(1), levelDb: +(10 * Math.log10(E[k])).toFixed(1) });
  }
  // merge adjacent windows
  const merged = [];
  for (const e of ev) {
    const last = merged[merged.length - 1];
    if (last && e.t - last.t < 0.003) { if (e.scoreDb > last.scoreDb) Object.assign(last, e); } else merged.push({ ...e });
  }
  return merged;
}

export function analyze(path, perf) {
  const { fs, channels } = readWav(path);
  const [L, R] = channels.length > 1 ? channels : [channels[0], channels[0]];
  const tp = truePeak(L, R);
  const lv = shortTermLevels(L, R, fs);
  const act = lv.filter((x) => x > -60).sort((a, b) => a - b);
  let maxJump = 0, maxJumpT = 0, clip = 0, dcL = 0, dcR = 0, eM = 0, eS = 0, eLR = 0, eL = 0, eR = 0;
  for (let i = 1; i < L.length; i++) {
    const j = Math.max(Math.abs(L[i] - L[i - 1]), Math.abs(R[i] - R[i - 1]));
    if (j > maxJump) { maxJump = j; maxJumpT = i / fs; }
    if (Math.abs(L[i]) >= 0.9999 || Math.abs(R[i]) >= 0.9999) clip++;
    dcL += L[i]; dcR += R[i];
    const m = 0.5 * (L[i] + R[i]), s = 0.5 * (L[i] - R[i]);
    eM += m * m; eS += s * s; eLR += L[i] * R[i]; eL += L[i] * L[i]; eR += R[i] * R[i];
  }
  const clicksL = detectClicks(L, fs), clicksR = detectClicks(R, fs);
  let events = [...clicksL, ...clicksR].sort((a, b) => b.scoreDb - a.scoreDb);
  // With a performance, HF bursts right at hammer strikes are attack transients, not clicks.
  const onsets = perf?.notes ? perf.notes.map((n) => n.on).sort((a, b) => a - b) : null;
  const nearOnset = (t) => { if (!onsets) return false; let lo = 0, hi = onsets.length; while (lo < hi) { const m = (lo + hi) >> 1; if (onsets[m] < t - 0.006) lo = m + 1; else hi = m; } return lo < onsets.length && onsets[lo] <= t + 0.002; };
  const onsetEvents = events.filter((e) => nearOnset(e.t));
  const clicks = events.filter((e) => !nearOnset(e.t));
  const res = {
    file: path, fs, seconds: +(L.length / fs).toFixed(2),
    samplePeakDb: +(20 * Math.log10(tp.samplePeak)).toFixed(2), truePeakDb: +(20 * Math.log10(tp.truePeak)).toFixed(2),
    rmsDb: +rmsDb(L, R).toFixed(2),
    activeShortTermDb: act.length ? { p05: +act[Math.floor(act.length * 0.05)].toFixed(1), p50: +act[Math.floor(act.length * 0.5)].toFixed(1), p95: +act[Math.floor(act.length * 0.95)].toFixed(1), max: +act[act.length - 1].toFixed(1) } : null,
    clippedSamples: clip, dc: [+(dcL / L.length).toExponential(2), +(dcR / R.length).toExponential(2)],
    lrCorrelation: +(eLR / Math.sqrt(eL * eR)).toFixed(3), sideToMidDb: +(10 * Math.log10(eS / eM)).toFixed(1),
    maxSampleJump: +maxJump.toFixed(4), maxSampleJumpAt: +maxJumpT.toFixed(3),
    clickCount: clicks.length, topClicks: clicks.slice(0, 12),
    onsetTransientEvents: onsets ? onsetEvents.length : undefined, loudestOnsetTransientHfDb: onsetEvents.length ? Math.max(...onsetEvents.map((e) => e.levelDb)) : undefined,
  };
  if (perf?.sections) {
    res.sections = perf.sections.map((s) => {
      const a = Math.round(s.on * fs), b = Math.min(L.length, Math.round(s.off * fs));
      const seg = (t0, t1) => { let e = 0; const i0 = a + Math.round(t0 * fs), i1 = Math.min(b, a + Math.round(t1 * fs)); for (let i = i0; i < i1; i++) e += 0.5 * (L[i] ** 2 + R[i] ** 2); return +(10 * Math.log10(e / Math.max(1, i1 - i0) + 1e-30)).toFixed(1); };
      return { name: s.name, rms0_05: seg(0, 0.5), rms1_15: seg(1, 1.5), rms2_3: seg(2, 3) };
    });
  }
  return res;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const perf = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : null;
  console.log(JSON.stringify(analyze(process.argv[2], perf), null, 1));
}
