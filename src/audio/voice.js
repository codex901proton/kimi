// Core string renderer. Every partial component, phantom partial and sympathetic mode is a
// damped 2nd-order resonator y[n] = a1*y[n-1] - a2*y[n-2] (a1 = 2r·cosω, a2 = r²).
// Damping changes are applied per 64-sample block while preserving the oscillator's complex
// amplitude, so dampers/pedal never produce discontinuities.
import { buildAllKeys, partialAmps, KEY_LO, KEY_HI, NOTE_SCALE, VREF, LOUD_EXP, SPLIT_HZ } from './piano-model.js';
import { mulberry32, hashSeed } from './rng.js';

export const BLK = 64;
export const THR = 2e-7; // absolute cull threshold (≈ −110 dB re a ff note partial)
const CAP = 1024;
const TWO_PI = 2 * Math.PI;

class Bank {
  constructor(cap) {
    this.n = 0;
    const f = () => new Float64Array(cap), i = () => new Int32Array(cap);
    this.y1 = f(); this.y2 = f(); this.a1 = f(); this.a2 = f(); this.cw = f(); this.sw = f(); this.isw = f();
    this.r = f(); this.sigU = f(); this.sigD = f(); this.dl = f(); this.kap = f(); this.w0 = f();
    this.koff = i(); this.pid = i(); this.drv = i();
  }

  add(freq, amp, phase, sigU, sigD, koff, pid, drv, kap, D0, fs) {
    if (this.n >= this.y1.length) return;
    const i = this.n++;
    const w = (TWO_PI * freq) / fs;
    const cw = Math.cos(w), sw = Math.sin(w);
    const r = Math.exp(-(sigU + D0 * D0 * sigD) / fs);
    this.cw[i] = cw; this.sw[i] = sw; this.isw[i] = 1 / sw; this.w0[i] = w;
    this.r[i] = r; this.a1[i] = 2 * r * cw; this.a2[i] = r * r;
    this.y1[i] = amp * Math.cos(phase); // n = 0
    this.y2[i] = (amp / r) * Math.cos(phase - w); // n = -1
    this.sigU[i] = sigU; this.sigD[i] = sigD; this.dl[i] = D0; this.kap[i] = kap;
    this.koff[i] = koff; this.pid[i] = pid; this.drv[i] = drv;
  }

  removeAt(i) {
    const j = --this.n;
    if (i === j) return;
    this.y1[i] = this.y1[j]; this.y2[i] = this.y2[j]; this.a1[i] = this.a1[j]; this.a2[i] = this.a2[j];
    this.cw[i] = this.cw[j]; this.sw[i] = this.sw[j]; this.isw[i] = this.isw[j]; this.r[i] = this.r[j];
    this.sigU[i] = this.sigU[j]; this.sigD[i] = this.sigD[j]; this.dl[i] = this.dl[j]; this.kap[i] = this.kap[j];
    this.koff[i] = this.koff[j]; this.pid[i] = this.pid[j]; this.drv[i] = this.drv[j]; this.w0[i] = this.w0[j];
  }

  // Tension-modulation pitch glide: retune own-string oscillators, preserving complex amplitude.
  retune(ratio) {
    const { n, y1, y2, r, cw, sw, isw, a1, w0, drv } = this;
    for (let i = 0; i < n; i++) {
      if (drv[i] >= 0) continue; // sympathetic modes belong to other strings
      const w = w0[i] * ratio, c = Math.cos(w), s = Math.sin(w);
      const zi = (r[i] * y2[i] - y1[i] * cw[i]) * isw[i];
      y2[i] = (y1[i] * c + zi * s) / r[i];
      cw[i] = c; sw[i] = s; isw[i] = 1 / s; a1[i] = 2 * r[i] * c;
    }
  }

  updateDamping(damp, gb, fs) {
    const n = this.n, dl = this.dl, koff = this.koff, sigU = this.sigU, sigD = this.sigD;
    const r = this.r, y2 = this.y2, a1 = this.a1, a2 = this.a2, cw = this.cw;
    for (let i = 0; i < n; i++) {
      const D = damp[koff[i] + gb];
      if (D !== dl[i]) {
        const rn = Math.exp(-(sigU[i] + D * D * sigD[i]) / fs); // light felt contact (half pedal) damps much less
        y2[i] *= r[i] / rn; // keep the complex amplitude unchanged
        r[i] = rn; a1[i] = 2 * rn * cw[i]; a2[i] = rn * rn; dl[i] = D;
      }
    }
  }

  // Hot loop: four independent recursions interleaved for ILP.
  render(buf, N) {
    const n = this.n, Y1 = this.y1, Y2 = this.y2, A1 = this.a1, A2 = this.a2;
    let i = 0;
    for (; i + 4 <= n; i += 4) {
      let p0 = Y1[i], q0 = Y2[i], p1 = Y1[i + 1], q1 = Y2[i + 1];
      let p2 = Y1[i + 2], q2 = Y2[i + 2], p3 = Y1[i + 3], q3 = Y2[i + 3];
      const c0 = A1[i], d0 = A2[i], c1 = A1[i + 1], d1 = A2[i + 1];
      const c2 = A1[i + 2], d2 = A2[i + 2], c3 = A1[i + 3], d3 = A2[i + 3];
      for (let s = 0; s < N; s++) {
        buf[s] += p0 + p1 + (p2 + p3);
        const t0 = c0 * p0 - d0 * q0; q0 = p0; p0 = t0;
        const t1 = c1 * p1 - d1 * q1; q1 = p1; p1 = t1;
        const t2 = c2 * p2 - d2 * q2; q2 = p2; p2 = t2;
        const t3 = c3 * p3 - d3 * q3; q3 = p3; p3 = t3;
      }
      Y1[i] = p0; Y2[i] = q0; Y1[i + 1] = p1; Y2[i + 1] = q1;
      Y1[i + 2] = p2; Y2[i + 2] = q2; Y1[i + 3] = p3; Y2[i + 3] = q3;
    }
    for (; i < n; i++) {
      let p = Y1[i], q = Y2[i];
      const c = A1[i], d = A2[i];
      for (let s = 0; s < N; s++) { buf[s] += p; const t = c * p - d * q; q = p; p = t; }
      Y1[i] = p; Y2[i] = q;
    }
  }
}

function cull(bank, alive, thr2) {
  const { y1, y2, r, cw, isw, drv, pid } = bank;
  for (let i = bank.n - 1; i >= 0; i--) {
    const a = y1[i], zi = (r[i] * y2[i] - a * cw[i]) * isw[i];
    if (a * a + zi * zi >= thr2) continue;
    const d = drv[i];
    if (d >= 0) { if (alive[d] > 0) continue; } // a mode can still be driven
    else if (pid[i] >= 0) alive[pid[i]]--;
    bank.removeAt(i);
  }
}

function accumulateZ(bank, needZ, ZR, ZI) {
  const { n, y1, y2, r, cw, isw, pid } = bank;
  for (let i = 0; i < n; i++) {
    const p = pid[i];
    if (p >= 0 && needZ[p]) { ZR[p] += y1[i]; ZI[p] += (r[i] * y2[i] - y1[i] * cw[i]) * isw[i]; }
  }
}

function injectModes(bank, ZR, ZI, dt) {
  const { n, y1, y2, r, cw, sw, drv, kap } = bank;
  for (let i = 0; i < n; i++) {
    const d = drv[i];
    if (d < 0) continue;
    const k = kap[i] * dt, qr = k * ZR[d], qi = k * ZI[d];
    y1[i] += qr;
    y2[i] += (qr * cw[i] + qi * sw[i]) / r[i];
  }
}

function bpfCoefs(f, q, fs) {
  const w = (TWO_PI * f) / fs, alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
  return { b0: alpha / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - alpha) / a0, norm: 1 / Math.sqrt(((Math.PI / 2) * (f / q)) / (fs / 2)) };
}

export function renderNoteSet(job) {
  const { notes, idxs, restrikes, fs, total, damp, nB, outL, outR, seed = 7, kappa0 = 0.25, flags = {} } = job;
  const keys = buildAllKeys(fs, kappa0);
  const ctx = {
    keys, fs, total, damp, nB, outL, outR, seed, kappa0, flags,
    lo: new Bank(CAP), hi: new Bank(CAP),
    lowBuf: new Float64Array(BLK), highBuf: new Float64Array(BLK),
    amps: new Float64Array(128), ZR: new Float64Array(128), ZI: new Float64Array(128),
    needZ: new Uint8Array(128), alive: new Int32Array(128),
    stats: { oscSamples: 0, voices: 0, maxOsc: 0 },
  };
  for (const ni of idxs) renderNote(notes[ni], ni, restrikes[ni] || [], ctx);
  return ctx.stats;
}

function renderNote(note, ni, rs, ctx) {
  const { keys, fs, total, damp, nB, outL, outR, lo, hi, lowBuf, highBuf, amps, ZR, ZI, needZ, alive, flags, stats } = ctx;
  const m = Math.min(KEY_HI, Math.max(KEY_LO, Math.round(note.midi)));
  const km = keys[m - KEY_LO];
  const v = Math.min(1, Math.max(0.01, note.vel));
  const n0 = Math.round(note.on * fs);
  if (!(n0 >= 0 && n0 < total)) return;
  const rng = mulberry32(hashSeed(ctx.seed, ni, m, n0));
  const np = km.np;
  partialAmps(km, v, amps);
  const loud = (v / VREF) ** LOUD_EXP;
  const scale = NOTE_SCALE * km.K * km.gReg * loud;
  let maxA = 0;
  for (let p = 0; p < np; p++) { amps[p] *= scale; if (amps[p] > maxA) maxA = amps[p]; }
  const floorA = Math.max(maxA * 3e-5, THR * 3);
  lo.n = 0; hi.n = 0;
  needZ.fill(0); alive.fill(0);
  const koff = (m - KEY_LO) * nB;
  const gb0 = Math.floor(n0 / BLK);
  const D0 = damp[koff + gb0];
  const S = km.S;

  if (!flags.noPartials) {
    for (let p = 0; p < np; p++) {
      const A = amps[p] * (1 + 0.08 * (rng() - 0.5)); // strike-to-strike hammer variation
      if (A < floorA) continue;
      const f = km.f[p];
      const bank = f < SPLIT_HZ ? lo : hi;
      const ph = km.phase[p] + 0.5 * (rng() - 0.5);
      const al = km.alpha[p], sD = km.sigDamp[p];
      // prompt sound (in-phase unison mode, strongly coupled to the bridge → fast decay)
      bank.add(km.sf0[p], A * (1 - al), ph, km.sigFast[p], sD, koff, p, -1, 0, D0, fs);
      // aftersound (out-of-phase unison / horizontal polarization → slow decay, detuned → beats)
      if (S === 3 && f < 5000) {
        const w = km.wsplit[p];
        bank.add(km.sf1[p], A * al * w, ph, km.sigSlow[p], sD, koff, p, -1, 0, D0, fs);
        bank.add(km.sf2[p], A * al * (1 - w), ph + km.phase2[p], km.sigSlow[p] * 1.1, sD, koff, p, -1, 0, D0, fs);
        alive[p] += 3;
      } else {
        bank.add(km.sf1[p], A * al, ph, km.sigSlow[p], sD, koff, p, -1, 0, D0, fs);
        alive[p] += 2;
      }
    }
    // Phantom partials (f_j + f_k) from tension modulation; ∝ v², boosted near the longitudinal mode.
    if (!flags.noPhantom && km.phantomW > 0 && v > 0.2) {
      const fmax = Math.min(16000, 0.45 * fs);
      const list = [];
      const jmax = Math.min(10, np);
      for (let j = 0; j < jmax; j++) {
        for (let k = j; k < jmax; k++) {
          const f = km.f[j] + km.f[k];
          if (f > fmax) continue;
          const z = (f - km.fL) / (0.12 * km.fL);
          const lr = 1 + 2.5 * Math.exp(-z * z);
          const A = 0.1 * v * v * km.phantomW * Math.sqrt(amps[j] * amps[k]) * lr * (j === k ? 0.5 : 1);
          if (A > floorA) list.push([A, f, j, k]);
        }
      }
      list.sort((a, b) => b[0] - a[0]);
      for (const [A, f, j, k] of list.slice(0, 14)) {
        const bank = f < SPLIT_HZ ? lo : hi;
        bank.add(f, A, TWO_PI * rng(), 0.5 * (km.sigFast[j] + km.sigFast[k]), Math.max(km.sigDamp[j], km.sigDamp[k]), koff, -1, -1, 0, D0, fs);
      }
    }
  }

  // Sympathetic modes on other strings whose partials coincide with ours.
  let nModes = 0;
  if (!flags.noSymp && !flags.noPartials) {
    for (const c of km.symp) {
      if (alive[c.pid] === 0) continue;
      const toff = (c.tkey - KEY_LO) * nB;
      const bank = c.tf < SPLIT_HZ ? lo : hi;
      bank.add(c.tf, 0, 0, c.tSigU, c.tSigD, toff, -1, c.pid, ctx.kappa0 * c.kbase, damp[toff + gb0], fs);
      needZ[c.pid] = 1;
      nModes++;
    }
  }

  // Hammer/action thump: soundboard knock (band-passed noise), contact noise, low board modes.
  const th = km.thump;
  const Aref = NOTE_SCALE * km.gReg * loud;
  const thN = flags.noThump ? 0 : Math.round(0.14 * fs);
  const kc = bpfCoefs(th.fk, th.qk, fs), ccf = bpfCoefs(th.fc, th.qc, fs);
  const gK = Aref * 0.3 * (0.55 + 0.45 * v) * th.wK * kc.norm;
  const gCt = Aref * 0.1 * v * v * ccf.norm * 1.4; // ×1.4: 4th-order band is narrower than the 2nd-order norm
  const decK = Math.exp(-1 / (th.tauK * fs)), decC = Math.exp(-1 / (th.tauC * fs));
  const attK = Math.round(0.0005 * fs), attC = Math.round(0.00025 * fs);
  let kx1 = 0, kx2 = 0, ky1 = 0, ky2 = 0, cx1 = 0, cx2 = 0, cy1 = 0, cy2 = 0, dx1 = 0, dx2 = 0, dy1 = 0, dy2 = 0, eK = 1, eC = 1;
  const NB = th.boardF.length;
  const bA1 = new Float64Array(NB), bA2 = new Float64Array(NB), bY1 = new Float64Array(NB), bY2 = new Float64Array(NB);
  for (let i = 0; i < NB; i++) {
    const w = (TWO_PI * th.boardF[i]) / fs, r = Math.exp(-6.91 / (th.boardT60[i] * fs));
    const amp = Aref * 0.2 * (0.5 + 0.5 * v) * th.boardW[i];
    bA1[i] = 2 * r * Math.cos(w); bA2[i] = r * r; bY1[i] = 0; bY2[i] = (-amp * Math.sin(w)) / r; // sine-phase start
  }

  const attN = Math.max(24, Math.round(fs * (0.0028 - 0.002 * v) * km.attackRegF));
  // Hard blows stretch the string: bass/tenor start up to ~7 cents sharp and settle within ~0.1 s.
  const glide = !flags.noGlide && m < 72 && v > 0.35;
  const gLn = glide ? ((7 * v * v * Math.max(0, 1 - (m - 21) / 51)) / 1200) * Math.LN2 : 0;
  const gTau = 0.08 * fs, glideN = Math.round(0.32 * fs);
  let glideDone = !glide;
  const dtB = BLK / fs;
  const gC = Math.SQRT1_2, gL = km.gL, gR = km.gR, dL = km.dL, dR = km.dR;
  const thr2 = THR * THR;
  let vg = 1, vgT = 1;
  const vgStep = 1 / (0.005 * fs);
  let rsi = 0;
  while (rsi < rs.length && rs[rsi] <= n0) rsi++;
  let blk = 0;
  stats.voices++;
  stats.maxOsc = Math.max(stats.maxOsc, lo.n + hi.n);

  for (let bs = n0; bs < total; bs += BLK) {
    const N = Math.min(BLK, total - bs);
    const gb = (bs / BLK) | 0;
    while (rsi < rs.length && rs[rsi] < bs + N) { vgT *= 0.8; rsi++; } // re-strike: hammer contact absorbs energy
    lo.updateDamping(damp, gb, fs);
    hi.updateDamping(damp, gb, fs);
    if (!glideDone && (blk & 1) === 0) {
      const o = bs - n0;
      const ratio = o >= glideN ? 1 : Math.exp(gLn * Math.exp(-(o + BLK) / gTau));
      lo.retune(ratio); hi.retune(ratio);
      if (o >= glideN) glideDone = true;
    }
    if (nModes > 0) {
      for (let p = 0; p < np; p++) if (needZ[p]) { ZR[p] = 0; ZI[p] = 0; }
      accumulateZ(lo, needZ, ZR, ZI); accumulateZ(hi, needZ, ZR, ZI);
      injectModes(lo, ZR, ZI, dtB); injectModes(hi, ZR, ZI, dtB);
    }
    lowBuf.fill(0); highBuf.fill(0);
    if (lo.n) lo.render(lowBuf, N);
    if (hi.n) hi.render(highBuf, N);
    stats.oscSamples += (lo.n + hi.n) * N;
    const off = bs - n0;
    if (off < attN) {
      for (let s = 0; s < N; s++) {
        const k = off + s;
        if (k >= attN) break;
        const e = 0.5 - 0.5 * Math.cos((Math.PI * k) / attN);
        lowBuf[s] *= e; highBuf[s] *= e;
      }
    }
    if (off < thN) {
      for (let s = 0; s < N; s++) {
        const k = off + s;
        if (k >= thN) break;
        const nz1 = rng() * 2 - 1, nz2 = rng() * 2 - 1;
        const ky = kc.b0 * (nz1 - kx2) - kc.a1 * ky1 - kc.a2 * ky2;
        kx2 = kx1; kx1 = nz1; ky2 = ky1; ky1 = ky;
        const cy = ccf.b0 * (nz2 - cx2) - ccf.a1 * cy1 - ccf.a2 * cy2;
        cx2 = cx1; cx1 = nz2; cy2 = cy1; cy1 = cy;
        // second section → 4th-order band-pass, keeps the contact tick out of the >15 kHz region
        const dy = ccf.b0 * (cy - dx2) - ccf.a1 * dy1 - ccf.a2 * dy2;
        dx2 = dx1; dx1 = cy; dy2 = dy1; dy1 = dy;
        const aK = k < attK ? 0.5 - 0.5 * Math.cos((Math.PI * k) / attK) : 1;
        const aC = k < attC ? 0.5 - 0.5 * Math.cos((Math.PI * k) / attC) : 1;
        eK *= decK; eC *= decC;
        let board = 0;
        for (let i = 0; i < NB; i++) {
          const y = bA1[i] * bY1[i] - bA2[i] * bY2[i];
          bY2[i] = bY1[i]; bY1[i] = y; board += y;
        }
        highBuf[s] += ky * gK * aK * eK + dy * gCt * aC * eC;
        lowBuf[s] += board;
      }
    }
    for (let s = 0; s < N; s++) {
      if (vg !== vgT) vg = vg > vgT ? Math.max(vgT, vg - vgStep) : Math.min(vgT, vg + vgStep);
      const l = lowBuf[s] * gC * vg, h = highBuf[s] * vg;
      const t = bs + s;
      outL[t] += l; outR[t] += l;
      outL[t + dL] += gL * h; outR[t + dR] += gR * h;
    }
    if ((++blk & 3) === 0) {
      cull(lo, alive, thr2); cull(hi, alive, thr2);
      if (lo.n + hi.n === 0 && off >= thN) break;
    }
  }
}
