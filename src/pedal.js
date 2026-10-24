// Sustain-pedal plan: legato (syncopated) pedal changes at harmonic changes, like a pianist.
import { barBeat as B, EDIT } from './score.js';

const pcs = (ns) => new Set(ns.map((n) => n.midi % 12));
function newClashes(held, fresh) {
  // semitone / whole-tone frictions introduced between sustained and newly struck pitch classes
  let c = 0;
  for (const a of fresh) for (const b of held) {
    if (fresh.has(b)) continue;
    const d = Math.min((a - b + 12) % 12, (b - a + 12) % 12);
    if (d === 1) c += 1; else if (d === 2) c += 0.6;
  }
  return c;
}

export function planPedal(notes, timeMap, endTime) {
  const triggerRole = (n) => {
    if (n.beat < B(15)) return n.role === 'bell' || n.role === 'theme';
    if (n.beat < B(44)) return n.role === 'melody' || n.role === 'bass' || n.role === 'bell';
    return n.role === 'bell' || (n.beat >= B(54) && n.beat < B(56));
  };
  const onsets = new Map();
  for (const n of notes) {
    const k = n.beat;
    if (!onsets.has(k)) onsets.set(k, []);
    onsets.get(k).push(n);
  }
  const beats = [...onsets.keys()].sort((a, b) => a - b);
  const changes = [];
  let sustained = new Set();
  let lastChange = -1;
  for (const beat of beats) {
    const group = onsets.get(beat);
    const t = Math.min(...group.map((n) => n.on));
    const trig = group.filter(triggerRole);
    const fresh = pcs(group);
    const section = beat < B(15) ? 'lento' : beat < B(44) ? 'agitato' : 'primo';
    const forced = [B(3), B(15), B(44), B(45), B(46), B(56), B(62), ...EDIT.map((e) => e.b0)].includes(beat);
    if (trig.length && (forced || newClashes(sustained, pcs(trig)) > 0.9 || newClashes(sustained, fresh) > 2.5) && t - lastChange > 0.22) {
      changes.push({ t, section });
      lastChange = t;
      sustained = new Set(fresh);
    } else {
      for (const p of fresh) sustained.add(p);
    }
  }
  // Breakpoints: up exactly as the new harmony sounds, down again ~80 ms later (dampers catch the old one).
  const pts = [{ t: 0, v: 0 }];
  const first = Math.min(...notes.map((n) => n.on));
  pts.push({ t: first - 0.25, v: 0 }, { t: first - 0.18, v: 1 });
  for (const c of changes) {
    if (c.t < first + 0.05) continue;
    const depth = c.section === 'agitato' ? 0.18 : 0;     // half-pedal flutter keeps the bass ringing
    const upDur = c.section === 'agitato' ? 0.035 : 0.04;
    const hold = c.section === 'agitato' ? 0.05 : 0.045;
    const down = c.section === 'agitato' ? 0.06 : 0.045;
    pts.push({ t: c.t - 0.012, v: 1 }, { t: c.t - 0.012 + upDur, v: depth }, { t: c.t + hold, v: depth }, { t: c.t + hold + down, v: 1 });
  }
  pts.push({ t: endTime - 0.6, v: 1 }, { t: endTime - 0.2, v: 0 });
  pts.sort((a, b) => a.t - b.t);
  return { points: pts, changes };
}

export function pedalAt(points, t) {
  if (t <= points[0].t) return points[0].v;
  let lo = 0, hi = points.length - 1;
  if (t >= points[hi].t) return points[hi].v;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (points[m].t <= t) lo = m; else hi = m; }
  const a = points[lo], b = points[hi];
  return b.t === a.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
}
