// Score → expressive performance timeline (tempo/rubato, dynamics, voicing).
// Bar numbering follows the LilyPond source: bar 1 is the 2-beat anacrusis,
// bar k (k ≥ 2) starts at beat 2 + 4·(k − 2). The piece ends at beat 246 (bar 62).
import { parseMidi, midiNotes } from './midi.js';
import { mulberry32 } from './util.js';

export const SCORE_MIDI = new URL('../data/rach-prelude-op3-no2.mid', import.meta.url).pathname;
export const LAST_BEAT = 246;
export const barBeat = (bar) => (bar <= 1 ? 0 : 2 + 4 * (bar - 2));
export const beatBar = (beat) => (beat < 2 ? 1 : 2 + Math.floor((beat - 2) / 4));

export const SECTIONS = [
  { beat: 0, title: 'Lento', subtitle: '' },
  { beat: barBeat(15), title: 'Agitato', subtitle: '' },
  { beat: barBeat(44), title: 'Tempo primo', subtitle: 'pesante' },
];

// Dynamic marks shown on the note highway (beat, text), as printed in the score.
export const MARKINGS = [
  [0, 'ff'], [barBeat(3), 'ppp'], [barBeat(7), 'mf'], [barBeat(9), 'ppp'], [barBeat(13), 'ppp'],
  [barBeat(15), 'mf'], [barBeat(17), 'cresc.'], [barBeat(18), 'dim.'], [barBeat(19), 'mf'],
  [barBeat(22), 'cresc.'], [barBeat(24), 'dim.'], [barBeat(26), 'cresc.'], [barBeat(28), 'ff'],
  [barBeat(31), 'dim.'], [barBeat(32), 'p'], [barBeat(35), 'cresc.'], [barBeat(36), 'fff'],
  [barBeat(44), 'sfff'], [barBeat(45), 'sfff'], [barBeat(46), 'fff'], [barBeat(47), 'sffff'],
  [barBeat(50), 'sffff'], [barBeat(54), 'dim.'], [barBeat(56), 'mf'], [barBeat(62), 'ppp'],
];

// Quarter-note tempo (BPM) breakpoints, linearly interpolated in beat space.
const B = barBeat;
const TEMPO = [
  [0, 44], [1.6, 42], [2, 40], [5.5, 42], [6, 52],                       // the three bells, let C# ring
  [B(3), 53], [B(4) - 1, 57], [B(5), 58], [B(6), 56], [B(7), 59], [B(8), 55], // ppp tolling chords
  [B(9), 54], [B(10), 57], [B(11), 58], [B(12), 55], [B(13), 52], [B(14), 50], [B(15) - 0.5, 44],
  [B(15), 124], [B(17), 132], [B(18) + 2, 134], [B(19), 126],             // Agitato
  [B(21), 130], [B(22), 136], [B(24), 134], [B(25), 128], [B(26), 132], [B(27) + 3, 142],
  [B(28), 140], [B(30), 138], [B(31), 132], [B(32), 124], [B(34), 128], [B(35), 136],
  [B(36), 144], [B(38), 140], [B(40), 132], [B(41), 124], [B(42), 112], [B(43), 98], [B(44) - 0.5, 70],
  [B(44), 50], [B(45), 48], [B(46) - 0.4, 40],                             // sfff bells, molto allargando
  [B(46), 47], [B(47), 47], [B(48), 48], [B(49), 47], [B(50), 46], [B(51), 47], // Tempo primo, pesante
  [B(52), 48], [B(53), 47], [B(54), 46], [B(55), 43], [B(56) - 0.5, 38],
  [B(56), 44], [B(58), 43], [B(60), 41], [B(61), 38], [B(62) - 0.5, 32],   // coda, dying away
  [B(62), 26], [LAST_BEAT, 26],                                            // final chord under fermata
];

// Agogic breaths: extra seconds taken just before a beat (spread over the preceding half beat).
const BREATHS = [
  [B(3), 0.35], [B(7), 0.12], [B(9), 0.22], [B(13), 0.18], [B(15), 0.25], [B(19), 0.08],
  [B(28), 0.1], [B(32), 0.12], [B(36), 0.12], [B(44), 0.35], [B(45), 0.25],
  [B(46), 0.3], [B(47), 0.18], [B(48), 0.12], [B(49), 0.12], [B(50), 0.22], [B(51), 0.1],
  [B(52), 0.12], [B(53), 0.12], [B(56), 0.3], [B(61), 0.25], [B(62), 0.4],
];

// Dynamic level 0..1 (ppp .14, p .3, mf .48, f .6, ff .72, fff .85, sffff 1).
const DYN = [
  [0, 0.76], [B(3) - 0.01, 0.74], [B(3), 0.15], [B(6), 0.2], [B(7), 0.44], [B(8), 0.34], [B(9), 0.15],
  [B(12), 0.17], [B(13), 0.13], [B(15) - 0.01, 0.12],
  [B(15), 0.46], [B(17), 0.5], [B(18), 0.6], [B(19), 0.46], [B(21), 0.47], [B(22), 0.52], [B(23), 0.62],
  [B(24), 0.6], [B(25), 0.46], [B(26), 0.5], [B(27) + 3.9, 0.68], [B(28), 0.74], [B(30) + 3.9, 0.74],
  [B(31), 0.6], [B(32), 0.33], [B(34) + 3.9, 0.36], [B(35), 0.5], [B(36), 0.86], [B(42), 0.84],
  [B(44) - 0.01, 0.86], [B(44), 0.9], [B(46), 0.88], [B(53) + 3.9, 0.88], [B(54), 0.78], [B(55), 0.56],
  [B(56) - 0.01, 0.44], [B(56), 0.46], [B(58), 0.4], [B(60), 0.32], [B(61), 0.26], [B(62), 0.15],
  [LAST_BEAT, 0.15],
];
const SFZ_BEATS = new Map([[B(44), 0.98], [B(45), 0.96], [B(47), 1.0], [B(50), 1.0]]);

function piecewise(points) {
  return (x) => {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i];
      if (x <= x1) {
        const [x0, y0] = points[i - 1];
        if (x1 === x0) return y1;
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return points[points.length - 1][1];
  };
}

export function buildTimeMap(startOffset) {
  const bpm = piecewise(TEMPO);
  const step = 1 / 192;
  const n = Math.ceil((LAST_BEAT + 8) / step) + 1;
  const times = new Float64Array(n);
  let t = startOffset;
  for (let i = 0; i < n; i++) {
    times[i] = t;
    const b = i * step + step / 2;
    let dt = (60 / bpm(b)) * step;
    for (const [bb, extra] of BREATHS) {
      const w = 0.5;
      if (b > bb - w && b < bb) {
        // raised-cosine bump integrating to `extra` over the half beat before bb
        const u = (b - (bb - w)) / w;
        dt += extra * (1 - Math.cos(2 * Math.PI * u)) * (step / w);
      }
    }
    t += dt;
  }
  const beatToTime = (beat) => {
    const x = Math.max(0, beat) / step;
    const i = Math.min(n - 2, Math.floor(x));
    const f = x - i;
    return times[i] + (times[i + 1] - times[i]) * f;
  };
  const timeToBeat = (time) => {
    if (time <= times[0]) return 0;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= time) lo = mid; else hi = mid; }
    return (lo + (time - times[lo]) / (times[lo + 1] - times[lo])) * step;
  };
  return { beatToTime, timeToBeat, bpm };
}

export function loadScore() {
  const midi = parseMidi(SCORE_MIDI);
  const D = midi.division;
  return midiNotes(midi).map((n, i) => ({
    id: i,
    midi: n.midi,
    track: n.track,
    staff: ['', 'upA', 'upB', 'downA', 'downB'][n.track],
    hand: n.track <= 2 ? 'R' : 'L',
    beat: n.startTick / D,
    endBeat: n.endTick / D,
  }));
}

// Expressive velocities: score dynamics + role-based voicing + seeded humanisation.
export function assignDynamics(notes) {
  const dyn = piecewise(DYN);
  const rnd = mulberry32(1892);
  const byOnset = new Map();
  for (const n of notes) {
    const k = `${n.hand}${n.beat}`;
    if (!byOnset.has(k)) byOnset.set(k, []);
    byOnset.get(k).push(n);
  }
  for (const n of notes) {
    const dur = n.endBeat - n.beat;
    const lento = n.beat < B(15) || n.beat >= B(44);
    const agitato = !lento;
    let v = dyn(n.beat + 1e-6);
    let role = 'chord';
    if (n.beat < B(3)) role = 'bell';
    else if (n.track === 2 || n.track === 4) role = 'bell';
    else if (lento && dur >= 0.99) role = n.hand === 'R' ? 'theme' : 'bell';
    else if (agitato && n.hand === 'R' && dur >= 0.9) role = 'melody';
    else if (agitato && dur < 0.4) role = 'accomp';
    else if (agitato && n.hand === 'L' && dur >= 0.9) role = 'bass';
    n.role = role;
    const boost = { bell: 0.07, theme: 0.11, melody: 0.08, accomp: -0.1, bass: 0.02, chord: 0 }[role];
    v += boost * (0.6 + 0.6 * v);
    const group = byOnset.get(`${n.hand}${n.beat}`);
    if (group.length > 1) {
      const hi = Math.max(...group.map((g) => g.midi)), lo = Math.min(...group.map((g) => g.midi));
      if (n.midi === hi && n.hand === 'R') v += 0.035;
      else if (n.midi === lo && n.hand === 'L') v += 0.025;
      else v -= 0.02;
    }
    const inBar = n.beat < 2 ? n.beat : (n.beat - 2) % 4;
    if (Math.abs(inBar) < 1e-6) v += 0.02; else if (Math.abs(inBar - 2) < 1e-6) v += 0.01;
    const sfz = SFZ_BEATS.get(n.beat);
    if (sfz) v = Math.max(v, sfz - (role === 'bell' ? 0 : 0.05));
    v += (rnd() - 0.5) * 0.04;
    n.vel = Math.min(1, Math.max(0.06, v));
  }
  return notes;
}

// Map beats to seconds and add micro-timing (chord spread, bass anticipation in slow sections).
export function assignTiming(notes, timeMap) {
  const rnd = mulberry32(31);
  for (const n of notes) {
    let on = timeMap.beatToTime(n.beat);
    const off = timeMap.beatToTime(n.endBeat);
    const slow = n.beat < B(15) || n.beat >= B(44);
    let jitter = (rnd() - 0.5) * (slow ? 0.012 : 0.007);
    if (slow && (n.role === 'bell' || n.role === 'bass') && n.hand === 'L') jitter -= 0.012;
    on += jitter;
    n.on = on;
    n.notatedOff = Math.max(on + 0.06, off);
  }
  notes.sort((a, b) => a.on - b.on || a.midi - b.midi);
  return notes;
}
