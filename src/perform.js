// Builds the full performance: notes with timing, dynamics, fingering, key motion, pedal.
import { loadScore, assignDynamics, assignTiming, buildTimeMap, SECTIONS, MARKINGS, EDIT, inEdit } from './score.js';
import { planHands } from './hands.js';
import { planPedal, pedalAt } from './pedal.js';
import { makeHandAnimator } from './render/handanim.js';

export const INTRO = 1.8;      // hands rise into place before the first bell
export const OUTRO_RING = 3.9; // the final chord rings under the fermata
export const OUTRO_CARD = 2.6; // closing card

export function buildPerformance() {
  const timeMap = buildTimeMap(INTRO);
  const notes = assignTiming(assignDynamics(loadScore()), timeMap);
  const hands = planHands(notes);
  const lastOn = Math.max(...notes.map((n) => n.on));
  const musicEnd = lastOn + OUTRO_RING;
  // The final chord is held by the fingers until the hands lift at the end.
  for (const n of notes) if (n.beat >= 242) n.keyUp = Math.max(n.keyUp, musicEnd - 2.2);
  const duration = musicEnd + OUTRO_CARD;
  const pedal = planPedal(notes, timeMap, musicEnd);
  // A key released early relies on the pedal: keep it down until the dampers are lifted again.
  const byFinger = new Map();
  for (const n of notes) {
    const k = `${n.hand}${n.finger}`;
    if (!byFinger.has(k)) byFinger.set(k, []);
    byFinger.get(k).push(n);
  }
  for (const seq of byFinger.values()) {
    for (let i = 0; i < seq.length; i++) {
      const n = seq[i];
      if (n.notatedOff - n.keyUp < 0.08) continue;
      let t = n.keyUp;
      while (pedalAt(pedal.points, t) < 0.85 && t < n.notatedOff) t += 0.005;
      const limit = seq[i + 1] ? seq[i + 1].tContact - 0.03 : Infinity;
      n.keyUp = Math.min(Math.max(n.keyUp, Math.min(t + 0.02, n.keyUp + 0.12)), limit, n.notatedOff);
    }
  }
  // A finger cannot hold a key the hand has moved away from (arm lift, leap): it lets go,
  // and the pedal — which is down in every such case we accept — keeps the string sounding.
  const keyNotes = Array.from({ length: 128 }, () => []);
  for (const n of notes) keyNotes[n.midi].push(n);
  for (const l of keyNotes) l.sort((a, b) => a.on - b.on);
  let released = 0;
  for (const hand of ['L', 'R']) {
    const anim = makeHandAnimator({ hands, notes, duration }, hand, keyNotes);
    for (const n of notes) {
      if (n.hand !== hand || n.beat >= 242) continue;
      for (let t = n.on + 0.1; t < n.keyUp; t += 1 / 120) {
        const F = anim.skeleton(t).fingers[n.finger];
        if (F.contact && F.note === n && !F.reached) {
          if (pedalAt(pedal.points, t) > 0.3 || pedalAt(pedal.points, t + 0.05) > 0.8) { n.keyUp = Math.max(n.on + 0.09, t - 0.01); released++; }
          break;
        }
      }
    }
  }
  const bars = [];
  for (const e of EDIT) for (let k = Math.max(2, e.from); k <= e.to; k++) bars.push({ t: timeMap.beatToTime(2 + 4 * (k - 2)), num: k });
  return {
    notes, hands, pedal, timeMap, duration, musicEnd, bars, released,
    sections: SECTIONS.map((s) => ({ ...s, t: timeMap.beatToTime(s.beat) })),
    markings: MARKINGS.filter(([beat]) => inEdit(beat)).map(([beat, text]) => ({ beat, text, t: timeMap.beatToTime(beat) })),
  };
}

export function toAudioJson(perf, sampleRate = 48000) {
  return {
    sampleRate,
    duration: perf.duration,
    notes: perf.notes.map((n) => ({ midi: n.midi, on: +n.on.toFixed(5), off: +n.keyUp.toFixed(5), vel: +n.vel.toFixed(4), hand: n.hand })),
    pedal: perf.pedal.points.map((p) => ({ t: +p.t.toFixed(5), v: p.v })),
  };
}
