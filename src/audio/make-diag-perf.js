#!/usr/bin/env node
// Diagnostic performance: C1..C8 at three velocities, chromatic sweep, ff C#-minor bells chord
// (pedal / no pedal / ppp), re-strikes under pedal, half pedal, and a sympathetic-halo A/B.
// Usage: node src/audio/make-diag-perf.js [out.json]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const out = process.argv[2] || 'out/diag-perf.json';
const notes = [], pedal = [{ t: 0, v: 0 }], sections = [];
let t = 0.3;
const pedalDown = (a, b, v = 1) => { pedal.push({ t: a, v: 0 }, { t: a + 0.06, v }, { t: b, v }, { t: b + 0.06, v: 0 }); };

// A: single Cs, three velocities, no pedal (key held 1.3 s)
for (const vel of [0.2, 0.5, 0.85]) {
  for (let m = 24; m <= 108; m += 12) {
    notes.push({ midi: m, on: t, off: t + 1.3, vel, hand: m < 60 ? 'L' : 'R' });
    sections.push({ name: `C${m / 12 - 1}@${vel}`, kind: 'single', midi: m, vel, on: t, off: t + 1.3 });
    t += 1.8;
  }
}
// B: chromatic sweep A0..C8, mf, staccato
const sweep0 = t;
for (let m = 21; m <= 108; m++) { notes.push({ midi: m, on: t, off: t + 0.15, vel: 0.5, hand: m < 60 ? 'L' : 'R' }); t += 0.18; }
sections.push({ name: 'chromatic', kind: 'sweep', on: sweep0, off: t });
t += 1.0;

const BELLS = [25, 37, 49, 52, 56, 61, 64, 68, 73];
const chord = (at, vel, hold) => {
  for (const m of BELLS) notes.push({ midi: m, on: at + (m < 40 ? 0 : 0.012), off: at + hold, vel: m < 40 ? Math.min(1, vel * 1.06) : vel, hand: m < 50 ? 'L' : 'R' });
};
// C: ff bells chord with pedal (dampers up 0.4 s before), keys up after 1 s, pedal up at +6 s
pedalDown(t - 0.4, t + 6);
chord(t, 0.85, 1.0);
sections.push({ name: 'bells-ff-pedal', kind: 'chord', on: t, off: t + 6.1 });
t += 8;
// D: same chord, no pedal, keys held 1.5 s (damper test)
chord(t, 0.85, 1.5);
sections.push({ name: 'bells-ff-nopedal', kind: 'chord', on: t, off: t + 1.5 });
t += 3.5;
// E: ppp chord with pedal
pedalDown(t - 0.4, t + 4);
chord(t, 0.15, 1.0);
sections.push({ name: 'bells-ppp-pedal', kind: 'chord', on: t, off: t + 4.1 });
t += 6;
// F: re-strikes of C#4 under pedal
pedalDown(t - 0.3, t + 3.5);
for (let i = 0; i < 4; i++) notes.push({ midi: 61, on: t + i * 0.35, off: t + i * 0.35 + 0.2, vel: 0.55 + 0.1 * i, hand: 'R' });
sections.push({ name: 'restrike-pedal', kind: 'restrike', on: t, off: t + 3.6 });
t += 5;
// G: half pedal release (pedal at 0.42) on a mf chord
pedal.push({ t: t - 0.3, v: 0 }, { t: t - 0.24, v: 1 }, { t: t + 1.0, v: 1 }, { t: t + 1.06, v: 0.42 }, { t: t + 3.0, v: 0.42 }, { t: t + 3.06, v: 0 });
for (const m of [37, 49, 56, 61, 64]) notes.push({ midi: m, on: t, off: t + 0.3, vel: 0.5, hand: 'L' });
sections.push({ name: 'half-pedal', kind: 'chord', on: t, off: t + 3.1 });
t += 4.5;
// H: sympathetic halo A/B — C2 ff held 4 s without pedal, then with pedal
notes.push({ midi: 36, on: t, off: t + 4, vel: 0.85, hand: 'L' });
sections.push({ name: 'C2-held-nopedal', kind: 'halo', on: t, off: t + 4 });
t += 5;
pedalDown(t - 0.4, t + 4);
notes.push({ midi: 36, on: t, off: t + 4, vel: 0.85, hand: 'L' });
sections.push({ name: 'C2-held-pedal', kind: 'halo', on: t, off: t + 4 });
t += 6;

pedal.sort((a, b) => a.t - b.t);
const perf = { sampleRate: 48000, duration: +(t + 1).toFixed(3), notes, pedal, sections };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(perf));
console.log(`wrote ${out}: ${notes.length} notes, duration ${perf.duration}s`);
