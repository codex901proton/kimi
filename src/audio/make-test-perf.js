#!/usr/bin/env node
// Build a test performance JSON from the MIDI (its own tempo map), with simple half-bar pedaling.
// Usage: node src/audio/make-test-perf.js [in.mid] [out.json]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseMidi, midiNotes } from '../midi.js';

const inp = process.argv[2] || 'data/rach-prelude-op3-no2.mid';
const out = process.argv[3] || 'out/test-perf.json';

const midi = parseMidi(inp);
const div = midi.division;
const tempos = midi.tracks.flat().filter((e) => e.kind === 'tempo').sort((a, b) => a.tick - b.tick);
if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, usPerQuarter: 500000 });
const segs = [];
let acc = 0;
for (let i = 0; i < tempos.length; i++) {
  segs.push({ tick: tempos[i].tick, sec: acc, spt: tempos[i].usPerQuarter / 1e6 / div });
  if (i + 1 < tempos.length) acc += (tempos[i + 1].tick - tempos[i].tick) * segs[i].spt;
}
const tickToSec = (t) => { let s = segs[0]; for (const g of segs) if (g.tick <= t) s = g; return s.sec + (t - s.tick) * s.spt; };

// LilyPond dynamic volumes (×127) → target velocity scale (ppp 0.15 … fff 0.85, sffff 1.0)
const VMAP = [[0, 0.08], [44.5, 0.15], [53.3, 0.22], [62.2, 0.3], [72.4, 0.4], [81.3, 0.5], [90.2, 0.62], [101.6, 0.72], [108, 0.85], [117, 0.95], [127, 1.0]];
const velMap = (v) => {
  for (let i = 1; i < VMAP.length; i++) {
    if (v <= VMAP[i][0]) { const [a, b] = [VMAP[i - 1], VMAP[i]]; return a[1] + ((b[1] - a[1]) * (v - a[0])) / (b[0] - a[0]); }
  }
  return 1;
};

let s = 12345;
const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };

const raw = midiNotes(midi);
const seen = new Map();
const notes = [];
for (const n of raw) {
  const on = tickToSec(n.startTick), off = tickToSec(n.endTick);
  const key = n.midi + ':' + n.startTick;
  const v = Math.min(1, Math.max(0.05, velMap(n.vel) * (1 + 0.04 * (rnd() - 0.5))));
  if (seen.has(key)) { const p = seen.get(key); p.vel = Math.max(p.vel, v); p.off = Math.max(p.off, off - 0.02); continue; }
  const note = { midi: n.midi, on: +on.toFixed(4), off: +(Math.max(on + 0.05, off - 0.02)).toFixed(4), vel: +v.toFixed(3), hand: n.track <= 2 ? 'R' : 'L' };
  seen.set(key, note);
  notes.push(note);
}
notes.sort((a, b) => a.on - b.on || a.midi - b.midi);
const lastOff = Math.max(...notes.map((n) => n.off));
const lastTick = Math.max(...raw.map((n) => n.endTick));

// Pedal: change at every bar line and half-bar (every 2 beats; the piece starts with a 2-beat pickup).
const pedal = [{ t: 0, v: 0 }, { t: 0.06, v: 0 }, { t: 0.11, v: 1 }];
for (let tick = 2 * div; tick < lastTick; tick += 2 * div) {
  const B = tickToSec(tick);
  pedal.push({ t: +(B - 0.04).toFixed(4), v: 1 }, { t: +B.toFixed(4), v: 0 }, { t: +(B + 0.06).toFixed(4), v: 0 }, { t: +(B + 0.11).toFixed(4), v: 1 });
}
pedal.push({ t: +(lastOff + 2.5).toFixed(4), v: 1 }, { t: +(lastOff + 2.58).toFixed(4), v: 0 });

const perf = { sampleRate: 48000, duration: +(lastOff + 6).toFixed(3), notes, pedal };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(perf));
console.log(`wrote ${out}: ${notes.length} notes, ${pedal.length} pedal points, duration ${perf.duration}s`);
