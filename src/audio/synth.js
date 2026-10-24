#!/usr/bin/env node
// Physically-informed concert-grand synthesizer (pure JS, no samples).
// Usage: node src/audio/synth.js <performance.json> <out.wav>
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDamperTable } from './dampers.js';
import { BLK } from './voice.js';
import { buildAllKeys, KEY_LO, KEY_HI } from './piano-model.js';
import { bodyEq, addPedalNoise } from './body.js';
import { hallReverb } from './reverb.js';
import { masterChain, truePeak, rmsDb, shortTermLevels } from './master.js';
import { writeWav24 } from './wav.js';

const DEFAULTS = {
  workers: 2, seed: 7, kappa0: 0.25, reverb: true, master: true, flags: {},
  reverbParams: { t60Low: 2.6, t60High: 0.5, preDelay: 0.022, erDb: -8, lateDb: -5 },
  masterParams: {}, log: true,
};

// Clamp, sort and merge doubled notes (same key struck twice within 6 ms → one stronger strike).
function prepareNotes(raw) {
  const ns = [];
  for (const n of raw || []) {
    const midi = Math.round(n.midi);
    if (!(midi >= KEY_LO && midi <= KEY_HI) || !Number.isFinite(n.on) || n.on < 0) continue;
    const vel = Math.min(1, Math.max(0.01, Number.isFinite(n.vel) ? n.vel : 0.5));
    const off = Number.isFinite(n.off) && n.off > n.on ? n.off : n.on + 0.05;
    ns.push({ midi, on: n.on, off, vel });
  }
  ns.sort((a, b) => a.on - b.on || a.midi - b.midi);
  const out = [], last = new Map();
  for (const n of ns) {
    const p = last.get(n.midi);
    if (p && n.on - p.on < 0.006) {
      p.vel = Math.min(1, Math.max(p.vel, n.vel) + 0.03 * Math.min(p.vel, n.vel));
      p.off = Math.max(p.off, n.off);
      continue;
    }
    out.push(n); last.set(n.midi, n);
  }
  return out;
}

function restrikeLists(notes, fs) {
  const byKey = new Map();
  notes.forEach((n, i) => { if (!byKey.has(n.midi)) byKey.set(n.midi, []); byKey.get(n.midi).push(i); });
  const rs = notes.map(() => []);
  for (const list of byKey.values()) {
    for (let a = 0; a < list.length; a++) {
      const on = notes[list[a]].on;
      for (let b = a + 1; b < list.length && notes[list[b]].on - on < 40; b++) rs[list[a]].push(Math.round(notes[list[b]].on * fs));
    }
  }
  return rs;
}

// Rough per-note cost (active partials × ringing time) for load balancing across workers.
function estimateCosts(notes, keys, D, nB, fs) {
  return notes.map((n) => {
    const km = keys[n.midi - KEY_LO];
    const off = (n.midi - KEY_LO) * nB;
    let b = Math.floor((n.on * fs) / BLK) + 1, life = km.T60;
    for (; b < nB; b++) if (D[off + b] > 0.5) { life = Math.min(life, (b * BLK) / fs - n.on + 0.3); break; }
    return Math.min(km.np, 40) * (km.S + 0.5) * Math.max(0.2, life);
  });
}

function runWorker(data) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./voice-worker.js', import.meta.url), { workerData: data });
    w.once('message', resolve);
    w.once('error', reject);
    w.once('exit', (c) => { if (c !== 0) reject(new Error('worker exit ' + c)); });
  });
}

export async function renderPerformance(perf, outWavPath, opts = {}) {
  const o = { ...DEFAULTS, ...opts, reverbParams: { ...DEFAULTS.reverbParams, ...(opts.reverbParams || {}) } };
  const log = (...a) => { if (o.log) console.error('[synth]', ...a); };
  const T0 = performance.now();
  const fs = perf.sampleRate || 48000;
  const total = Math.max(1, Math.round((perf.duration || 0) * fs));
  const notes = prepareNotes(perf.notes);
  const keys = buildAllKeys(fs, o.kappa0);
  const damper = buildDamperTable(notes, perf.pedal, fs, BLK, total);
  const restrikes = restrikeLists(notes, fs);
  const costs = estimateCosts(notes, keys, damper.D, damper.nB, fs);

  const W = Math.max(1, o.workers | 0);
  const loads = new Array(W).fill(0), assign = Array.from({ length: W }, () => []);
  notes.map((_, i) => i).sort((a, b) => costs[b] - costs[a]).forEach((i) => {
    let w = 0;
    for (let k = 1; k < W; k++) if (loads[k] < loads[w]) w = k;
    loads[w] += costs[i]; assign[w].push(i);
  });
  assign.forEach((a) => a.sort((x, y) => x - y));
  log(`notes=${notes.length} duration=${(total / fs).toFixed(2)}s workers=${W}`);

  const bufs = assign.map(() => ({ L: new SharedArrayBuffer((total + 16) * 8), R: new SharedArrayBuffer((total + 16) * 8) }));
  const T1 = performance.now();
  const res = await Promise.all(assign.map((idxs, w) => runWorker({
    notes, idxs, restrikes, fs, total, nB: damper.nB, dampSab: damper.sab,
    outLSab: bufs[w].L, outRSab: bufs[w].R, seed: o.seed, kappa0: o.kappa0, flags: o.flags,
  })));
  const tStrings = (performance.now() - T1) / 1000;
  log(`strings rendered in ${tStrings.toFixed(1)}s`, res.map((r) => r.stats));

  const L = new Float64Array(total), R = new Float64Array(total);
  for (const b of bufs) {
    const bl = new Float64Array(b.L), br = new Float64Array(b.R);
    for (let i = 0; i < total; i++) { L[i] += bl[i]; R[i] += br[i]; }
  }
  if (!o.flags.noPedalNoise) addPedalNoise(L, R, damper.pedalV, BLK, fs);
  bodyEq(L, R, fs);

  let tRev = 0;
  if (o.reverb) {
    const T2 = performance.now();
    const { wetL, wetR } = hallReverb(L, R, fs, o.reverbParams);
    for (let i = 0; i < total; i++) { L[i] += wetL[i]; R[i] += wetR[i]; }
    tRev = (performance.now() - T2) / 1000;
    log(`reverb in ${tRev.toFixed(1)}s`);
  }

  let nan = 0;
  for (let i = 0; i < total; i++) {
    if (!Number.isFinite(L[i])) { L[i] = 0; nan++; }
    if (!Number.isFinite(R[i])) { R[i] = 0; nan++; }
  }

  let mst = null;
  if (o.master) mst = masterChain(L, R, fs, o.masterParams);
  else if (o.normalize !== false) {
    const tp = truePeak(L, R), g = 10 ** (-1 / 20) / Math.max(1e-12, tp.truePeak);
    for (let i = 0; i < total; i++) { L[i] *= g; R[i] *= g; }
  }

  const tp = truePeak(L, R);
  const lv = shortTermLevels(L, R, fs).filter((x) => x > -70).sort((a, b) => a - b);
  const wav = writeWav24(outWavPath, L, R, fs);
  const stats = {
    out: outWavPath, sampleRate: fs, seconds: +(total / fs).toFixed(3), notes: notes.length,
    samplePeakDb: +(20 * Math.log10(tp.samplePeak)).toFixed(2), truePeakDb: +(20 * Math.log10(tp.truePeak)).toFixed(2),
    rmsDb: +rmsDb(L, R).toFixed(2),
    shortTermDb: lv.length ? { p10: +lv[Math.floor(lv.length * 0.1)].toFixed(1), p50: +lv[Math.floor(lv.length * 0.5)].toFixed(1), p95: +lv[Math.floor(lv.length * 0.95)].toFixed(1), max: +lv[lv.length - 1].toFixed(1) } : null,
    nanFixed: nan, clippedOnWrite: wav.clipped,
    oscSamples: res.reduce((s, r) => s + r.stats.oscSamples, 0),
    renderSeconds: { strings: +tStrings.toFixed(1), reverb: +tRev.toFixed(1), total: +((performance.now() - T0) / 1000).toFixed(1) },
    master: mst,
  };
  log(JSON.stringify(stats));
  return stats;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [inp, out] = process.argv.slice(2);
  if (!inp || !out) { console.error('usage: node src/audio/synth.js <performance.json> <out.wav>'); process.exit(2); }
  const perf = JSON.parse(readFileSync(inp, 'utf8'));
  renderPerformance(perf, out).then((s) => console.log(JSON.stringify(s, null, 2))).catch((e) => { console.error(e); process.exit(1); });
}
